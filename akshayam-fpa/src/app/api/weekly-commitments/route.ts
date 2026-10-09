import { NextResponse } from "next/server";
import { z } from "zod";
import { query, queryOne, transaction } from "@/lib/db";
import { getEntity } from "@/lib/entity";
import { apiGuard } from "@/lib/auth/dal";
import { roleCan } from "@/lib/auth/permissions";
import {
  WEEKLY_FIRST_WEEK_END,
  WEEKLY_MEASURES,
  defaultMeetingDate,
  isLocked,
  isSaturday,
  todayIst,
} from "@/lib/weekly";

export const runtime = "nodejs";

/**
 * Record a vertical head's weekly commitment, say whether it was achieved, or
 * (an admin) reopen a frozen one.
 *
 * A commitment is a set of customer lines, each an amount the head undertakes
 * to bring in that week; their sum is the figure the week is rated against. The
 * amounts freeze at the end of the day they are first keyed, so a commitment
 * cannot be improved once the week's figures are known. "Achieved?" is the
 * outcome, said afterwards, and so stays editable.
 *
 * Who may commit: anyone whose role carries `weekly.commit`, and a team lead
 * signed in to their own vertical's slice - those logins are read-only
 * viewers everywhere else, but the commitment is exactly theirs to make.
 */
const Week = {
  verticalId: z.number().int().positive(),
  measure: z.enum(WEEKLY_MEASURES),
  weekEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
};

const Save = z.object({
  action: z.literal("save"),
  ...Week,
  meetingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  lines: z
    .array(
      z.object({
        customer: z.string().trim().min(1).max(300),
        amount: z.number().finite().positive(),
      }),
    )
    .min(1)
    .max(200),
});

const Outcome = z.object({
  action: z.literal("outcome"),
  ...Week,
  achieved: z.enum(["yes", "partly", "no"]).nullable(),
  remarks: z.string().max(2000).nullable(),
});

const Reopen = z.object({ action: z.literal("reopen"), ...Week });

const Body = z.discriminatedUnion("action", [Save, Outcome, Reopen]);

export async function POST(request: Request) {
  const { user, denied } = await apiGuard("reports.view");
  if (denied) return denied;

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });

  try {
    // The tab is a per-person grant like the other report pages; without it the
    // person has no business writing to it either.
    if (!user.reportAccess.includes("weekly")) {
      return fail("You have not been given access to Weekly ratings.", 403);
    }
    const entity = await getEntity();
    const isAdmin = roleCan(user.role, "users.manage");
    const canCommit = roleCan(user.role, "weekly.commit") || entity.verticalIds !== null;
    if (!canCommit) return fail("Your role does not allow recording a commitment.", 403);

    // The vertical must be one this view actually holds - never another's.
    const vertical = await queryOne<{ id: number; entity_id: number }>(
      `select id, entity_id from verticals
        where id = $1 and entity_id = any($2::int[])
          and ($3::int[] is null or id = any($3::int[]))`,
      [parsed.verticalId, entity.memberIds, entity.verticalIds],
    );
    if (!vertical) return fail("That vertical is not part of this view.", 403);

    if (!isSaturday(parsed.weekEnd) || parsed.weekEnd < WEEKLY_FIRST_WEEK_END) {
      return fail(`A week ends on a Saturday, from ${WEEKLY_FIRST_WEEK_END} onward.`);
    }

    const today = todayIst();
    const existing = await queryOne<{
      id: number;
      entered_on: string;
      reopened_on: string | null;
    }>(
      `select id, entered_on::text, reopened_on::text from weekly_commitments
        where vertical_id = $1 and week_end = $2 and measure = $3`,
      [parsed.verticalId, parsed.weekEnd, parsed.measure],
    );

    if (parsed.action === "reopen") {
      if (!isAdmin) return fail("Only an admin can reopen a frozen commitment.", 403);
      if (!existing) return fail("There is no commitment to reopen.", 404);
      await query("update weekly_commitments set reopened_on = $2, updated_at = now() where id = $1", [
        existing.id,
        today,
      ]);
      return NextResponse.json({ ok: true });
    }

    if (parsed.action === "outcome") {
      if (!existing) return fail("Nothing has been committed for this week yet.", 404);
      await query(
        `update weekly_commitments
            set achieved = $2, remarks = $3, updated_by = $4, updated_at = now()
          where id = $1`,
        [existing.id, parsed.achieved, parsed.remarks?.trim() || null, user.id],
      );
      return NextResponse.json({ ok: true });
    }

    // save
    if (existing && isLocked(existing.entered_on, existing.reopened_on, today)) {
      return fail(
        `This commitment was keyed on ${existing.entered_on} and froze at the end of that day. ` +
          "An admin can reopen it.",
        409,
      );
    }
    const meetingDate = parsed.meetingDate ?? defaultMeetingDate(parsed.weekEnd);
    if (!isSaturday(meetingDate)) return fail("The meeting date must be a Saturday.");

    await transaction(async (client) => {
      const header = await client.query<{ id: number }>(
        `insert into weekly_commitments
           (entity_id, vertical_id, measure, week_end, meeting_date, entered_on, created_by, updated_by)
         values ($1, $2, $3, $4, $5, $6, $7, $7)
         on conflict (vertical_id, week_end, measure)
         do update set meeting_date = excluded.meeting_date, updated_by = excluded.updated_by,
                       updated_at = now()
         returning id`,
        [vertical.entity_id, parsed.verticalId, parsed.measure, parsed.weekEnd, meetingDate, today, user.id],
      );
      const id = header.rows[0].id;
      await client.query("delete from weekly_commitment_lines where commitment_id = $1", [id]);
      for (const line of parsed.lines) {
        await client.query(
          "insert into weekly_commitment_lines (commitment_id, customer_name, amount) values ($1, $2, $3)",
          [id, line.customer.trim(), line.amount],
        );
      }
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not save.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

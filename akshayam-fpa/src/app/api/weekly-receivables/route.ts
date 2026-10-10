import { NextResponse } from "next/server";
import { z } from "zod";
import { query, queryOne } from "@/lib/db";
import { getEntity } from "@/lib/entity";
import { apiGuard } from "@/lib/auth/dal";
import { roleCan } from "@/lib/auth/permissions";
import { WEEKLY_FIRST_WEEK_END, isLocked, isSaturday, todayIst } from "@/lib/weekly";

export const runtime = "nodejs";

/**
 * Save a note on the MAK meeting's Receivables tab: what the head commits to on
 * a receivable over 180 days, how that went in a later week, or the follow-up on
 * a customer's TDS that Form 26AS does not yet show.
 *
 * A commitment's text can be changed until the end of the day it was first keyed,
 * as every commitment on the screen can; the review, whether it was achieved, and
 * the TDS remark are said afterwards and stay open. Who may write, and which
 * verticals, are the same rules the revenue and collection commitments follow.
 */
const Where = {
  verticalId: z.number().int().positive(),
  weekEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  customer: z.string().trim().min(1).max(300),
};

const Commitment = z.object({
  action: z.literal("commitment"),
  ...Where,
  text: z.string().max(4000),
});
const Review = z.object({
  action: z.literal("review"),
  ...Where,
  review: z.string().max(4000).nullable(),
  achieved: z.enum(["yes", "partly", "no"]).nullable(),
});
const TdsRemark = z.object({
  action: z.literal("tds"),
  ...Where,
  remark: z.string().max(4000),
});
const Body = z.discriminatedUnion("action", [Commitment, Review, TdsRemark]);

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
    if (!user.reportAccess.includes("weekly")) {
      return fail("You have not been given access to the MAK meeting.", 403);
    }
    const entity = await getEntity();
    const canCommit = roleCan(user.role, "weekly.commit") || entity.verticalIds !== null;
    if (!canCommit) return fail("Your role does not allow recording a note.", 403);

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
    const kind = parsed.action === "tds" ? "tds" : "over180";
    const existing = await queryOne<{ id: number; entered_on: string }>(
      `select id, entered_on::text from weekly_receivable_notes
        where vertical_id = $1 and week_end = $2 and customer = $3 and kind = $4`,
      [parsed.verticalId, parsed.weekEnd, parsed.customer, kind],
    );

    if (parsed.action === "commitment") {
      if (existing && isLocked(existing.entered_on, null, today)) {
        return fail(
          `This commitment was keyed on ${existing.entered_on} and froze at the end of that day.`,
          409,
        );
      }
      await query(
        `insert into weekly_receivable_notes
           (entity_id, vertical_id, week_end, customer, kind, commitment, entered_on, updated_by)
         values ($1, $2, $3, $4, 'over180', $5, $6, $7)
         on conflict (vertical_id, week_end, customer, kind)
         do update set commitment = excluded.commitment, updated_by = excluded.updated_by,
                       updated_at = now()`,
        [vertical.entity_id, parsed.verticalId, parsed.weekEnd, parsed.customer, parsed.text.trim() || null, today, user.id],
      );
      return NextResponse.json({ ok: true });
    }

    if (parsed.action === "review") {
      if (!existing) return fail("There is no commitment to review for that week.", 404);
      await query(
        `update weekly_receivable_notes
            set review = $2, achieved = $3, updated_by = $4, updated_at = now()
          where id = $1`,
        [existing.id, parsed.review?.trim() || null, parsed.achieved, user.id],
      );
      return NextResponse.json({ ok: true });
    }

    // the TDS remark: always open, one per customer per week
    await query(
      `insert into weekly_receivable_notes
         (entity_id, vertical_id, week_end, customer, kind, remark, entered_on, updated_by)
       values ($1, $2, $3, $4, 'tds', $5, $6, $7)
       on conflict (vertical_id, week_end, customer, kind)
       do update set remark = excluded.remark, updated_by = excluded.updated_by, updated_at = now()`,
      [vertical.entity_id, parsed.verticalId, parsed.weekEnd, parsed.customer, parsed.remark.trim() || null, today, user.id],
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not save.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

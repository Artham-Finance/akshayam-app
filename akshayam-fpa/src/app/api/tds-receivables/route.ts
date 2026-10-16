import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { getEntity, getVerticalsInScope } from "@/lib/entity";
import { apiGuard } from "@/lib/auth/dal";
import { roleCan } from "@/lib/auth/permissions";

export const runtime = "nodejs";

/**
 * Save what the vertical's head keeps against a row of the MAK meeting's TDS
 * receivables tab: the invoice it relates to, the observation and the follow-up
 * action. The year, vertical, customer and TDS amount are the sheet's and cannot
 * be changed here.
 *
 * Who may write follows the other tabs' rule, and a row can be written only if its
 * vertical is one the signed-in entity covers - a vertical's head cannot touch
 * another vertical's rows.
 */
const Body = z.object({
  id: z.number().int().positive(),
  invNumber: z.string().max(500),
  invDate: z.string().max(100),
  invValue: z.string().max(100),
  observation: z.string().max(4000),
  followUp: z.string().max(4000),
});

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

    const ids = (await getVerticalsInScope(entity)).map((v) => v.id);
    const text = (s: string) => s.trim() || null;
    const updated = await query(
      `update tds_receivables
          set inv_number = $2, inv_date = $3, inv_value = $4, observation = $5, follow_up = $6,
              updated_by = $7, updated_at = now()
        where id = $1 and vertical_id = any($8::int[])
        returning id`,
      [
        parsed.id,
        text(parsed.invNumber),
        text(parsed.invDate),
        text(parsed.invValue),
        text(parsed.observation),
        text(parsed.followUp),
        user.id,
        ids,
      ],
    );
    if (updated.length === 0) return fail("That row is not part of this view.", 403);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not save.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

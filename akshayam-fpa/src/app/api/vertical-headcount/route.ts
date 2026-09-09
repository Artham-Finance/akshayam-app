import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { getEntity } from "@/lib/entity";
import { fyMonths } from "@/lib/period";
import { apiGuard } from "@/lib/auth/dal";

export const runtime = "nodejs";

/**
 * Record a vertical's head count for a month, from the cost-apportionment card.
 *
 * Head count drives four of the apportioned pool heads, and RBJV's trainees
 * move between verticals - and new ones join - through the year. Each month is
 * its own figure; `applyForward` carries the new value to the rest of the
 * financial year, which is the usual case (someone joined and stayed).
 */
const Body = z.object({
  verticalId: z.number().int().positive(),
  fyStartYear: z.number().int(),
  month: z.string().regex(/^\d{4}-\d{2}-01$/),
  heads: z.number().int().min(0).max(999),
  applyForward: z.boolean().optional(),
});

export async function POST(request: Request) {
  const { denied } = await apiGuard("verticals.manage");
  if (denied) return denied;

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  try {
    const entity = await getEntity();

    // The vertical must belong to a company the user is looking at.
    const owns = await query<{ id: number }>(
      "select id from verticals where id = $1 and entity_id = any($2::int[])",
      [body.verticalId, entity.memberIds],
    );
    if (owns.length === 0) {
      return NextResponse.json(
        { error: "Not a vertical for this company." },
        { status: 400 },
      );
    }

    const months = body.applyForward
      ? fyMonths(body.fyStartYear, entity.fy_start_month)
          .map((m) => m.start)
          .filter((start) => start >= body.month)
      : [body.month];

    await query(
      `insert into vertical_headcount (vertical_id, fy_start_year, month, heads)
       select $1, $2, m::date, $4 from unnest($3::date[]) as m
       on conflict (vertical_id, fy_start_year, month) where month is not null
         do update set heads = excluded.heads`,
      [body.verticalId, body.fyStartYear, months, body.heads],
    );

    return NextResponse.json({ ok: true, months: months.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not save.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

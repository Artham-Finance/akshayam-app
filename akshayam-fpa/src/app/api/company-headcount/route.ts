import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { getEntity } from "@/lib/entity";
import { fyMonths } from "@/lib/period";
import { apiGuard } from "@/lib/auth/dal";

export const runtime = "nodejs";

/**
 * Record the company's total head count for a month, from the cost
 * apportionment comparison card - every person in the company, not just the
 * six verticals it apportions across. Same shape as vertical head count:
 * each month is its own figure, and `applyForward` carries a new value to
 * the rest of the financial year.
 */
const Body = z.object({
  entityId: z.number().int().positive(),
  fyStartYear: z.number().int(),
  month: z.string().regex(/^\d{4}-\d{2}-01$/),
  heads: z.number().int().min(0).max(9999),
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

    // The entity must be a company the user is looking at.
    if (!entity.memberIds.includes(body.entityId)) {
      return NextResponse.json({ error: "Not a company for this view." }, { status: 400 });
    }

    const months = body.applyForward
      ? fyMonths(body.fyStartYear, entity.fy_start_month)
          .map((m) => m.start)
          .filter((start) => start >= body.month)
      : [body.month];

    await query(
      `insert into company_headcount (entity_id, fy_start_year, month, heads)
       select $1, $2, m::date, $4 from unnest($3::date[]) as m
       on conflict on constraint company_headcount_entity_id_fy_start_year_month_key
         do update set heads = excluded.heads`,
      [body.entityId, body.fyStartYear, months, body.heads],
    );

    return NextResponse.json({ ok: true, months: months.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not save.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

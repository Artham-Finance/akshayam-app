import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { getEntity } from "@/lib/entity";
import { fyMonths } from "@/lib/period";
import { apiGuard } from "@/lib/auth/dal";

export const runtime = "nodejs";

/**
 * Key in "Common cost apportionment"'s actual for a month, on the Budget vs
 * Actual statement.
 *
 * Nothing books this as a cost in Zoho - it is Akshayam's share of RBJV's
 * common cost, apportioned in the budget but never posted as an actual - so
 * there is no ledger figure for the statement to read, and it is entered by
 * hand instead. Same shape as the other keyed-entry endpoints: each month is
 * its own figure, and `applyForward` carries a new value to the rest of the
 * financial year.
 */
const Body = z.object({
  entityId: z.number().int().positive(),
  fyStartYear: z.number().int(),
  month: z.string().regex(/^\d{4}-\d{2}-01$/),
  amount: z.number().finite(),
  applyForward: z.boolean().optional(),
});

export async function POST(request: Request) {
  const { denied } = await apiGuard("expenses.record");
  if (denied) return denied;

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  try {
    const entity = await getEntity();

    if (!entity.memberIds.includes(body.entityId)) {
      return NextResponse.json({ error: "Not a company for this view." }, { status: 400 });
    }

    const months = body.applyForward
      ? fyMonths(body.fyStartYear, entity.fy_start_month)
          .map((m) => m.start)
          .filter((start) => start >= body.month)
      : [body.month];

    await query(
      `insert into common_cost_apportionment_actual (entity_id, fy_start_year, month, amount)
       select $1, $2, m::date, $4 from unnest($3::date[]) as m
       on conflict (entity_id, fy_start_year, month) where month is not null
         do update set amount = excluded.amount`,
      [body.entityId, body.fyStartYear, months, body.amount],
    );

    return NextResponse.json({ ok: true, months: months.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not save.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

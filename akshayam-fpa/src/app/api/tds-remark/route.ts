import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { getEntity } from "@/lib/entity";
import { apiGuard } from "@/lib/auth/dal";

export const runtime = "nodejs";

/**
 * Why a TDS entry is not in Zoho, or whatever else explains a customer's gap
 * between the books and Form 26AS - one free-text note per customer per
 * quarter, since a "ret_only" customer has no invoice for a reader to point
 * at instead.
 */
const Body = z.object({
  fyStartYear: z.number().int(),
  quarter: z.number().int().min(1).max(4),
  customer: z.string().min(1).max(300),
  remark: z.string().max(2000),
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
    if (entity.verticalIds) {
      return NextResponse.json(
        { error: "A partner view has no reconciliation of its own to annotate." },
        { status: 400 },
      );
    }

    const clean = body.remark.trim();
    if (clean === "") {
      await query(
        `delete from tds_remarks
          where entity_id = $1 and fy_start_year = $2 and quarter = $3 and customer = $4`,
        [entity.id, body.fyStartYear, body.quarter, body.customer],
      );
      return NextResponse.json({ ok: true, cleared: true });
    }

    await query(
      `insert into tds_remarks (entity_id, fy_start_year, quarter, customer, remark, updated_at)
       values ($1, $2, $3, $4, $5, now())
       on conflict (entity_id, fy_start_year, quarter, customer)
       do update set remark = excluded.remark, updated_at = now()`,
      [entity.id, body.fyStartYear, body.quarter, body.customer, clean],
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not save.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

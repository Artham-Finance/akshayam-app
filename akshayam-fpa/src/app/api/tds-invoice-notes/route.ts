import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { getEntity } from "@/lib/entity";
import { apiGuard } from "@/lib/auth/dal";
import { roleCan } from "@/lib/auth/permissions";
import { tdsInvoiceEntity } from "@/lib/reports/tds-receivables";

export const runtime = "nodejs";

/**
 * Save the observation and the follow-up action against an invoice's TDS on the MAK
 * meeting's TDS receivables tab (the current year, invoice by invoice and quarter by
 * quarter). Who may write follows the other tabs' rule, and the invoice must be one the
 * signed-in entity can see - a vertical's head cannot write against another vertical's.
 */
const Body = z.object({
  fyStartYear: z.number().int().min(2000).max(2100),
  quarter: z.number().int().min(1).max(4),
  customer: z.string().trim().min(1).max(300),
  invoiceNumber: z.string().trim().max(200),
  /** the vertical the TDS is booked to; 0 for none */
  verticalId: z.number().int().min(0),
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

    const entityId = await tdsInvoiceEntity(
      entity,
      parsed.fyStartYear,
      parsed.quarter as 1 | 2 | 3 | 4,
      parsed.customer,
      parsed.invoiceNumber,
      parsed.verticalId,
    );
    if (entityId === null) return fail("That invoice is not part of this view.", 403);

    const text = (s: string) => s.trim() || null;
    await query(
      `insert into tds_invoice_notes
         (entity_id, fy_start_year, quarter, customer, invoice_number, vertical_id, observation, follow_up, updated_by)
       values ($1, $2, $3, $4, $5, $9, $6, $7, $8)
       on conflict (entity_id, fy_start_year, quarter, customer, invoice_number, vertical_id)
       do update set observation = excluded.observation, follow_up = excluded.follow_up,
                     updated_by = excluded.updated_by, updated_at = now()`,
      [
        entityId,
        parsed.fyStartYear,
        parsed.quarter,
        parsed.customer,
        parsed.invoiceNumber,
        text(parsed.observation),
        text(parsed.followUp),
        user.id,
        parsed.verticalId,
      ],
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not save.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

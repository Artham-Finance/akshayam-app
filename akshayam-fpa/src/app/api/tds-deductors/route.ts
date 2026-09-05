import { NextResponse } from "next/server";
import { z } from "zod";
import { transaction } from "@/lib/db";
import { getEntity } from "@/lib/entity";
import { resolveTdsCustomers } from "@/lib/ingest";
import { normaliseParty } from "@/lib/reports/tds-match";
import { apiGuard } from "@/lib/auth/dal";

export const runtime = "nodejs";

/**
 * Deductor -> customer mapping.
 *
 * Form 26AS names a deductor the way it is registered with the department
 * ("RAM NATH AND CO PRIVATE LIMITED"); Zoho names the same party the way the
 * firm bills it ("Ram Nath & Co Pvt Ltd"). Most join on a normalised form. The
 * rest are recorded here rather than guessed, because attributing a tax credit
 * to the wrong customer is worse than leaving it unattributed.
 *
 * Saving re-resolves every TDS line for the company in the same transaction, so
 * the reconciliation reflects the decision immediately and the mapping is not
 * left describing something the reports disagree with.
 */

const BodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("map"),
    deductorName: z.string().trim().min(1).max(240),
    customerName: z.string().trim().min(1).max(240),
  }),
  z.object({
    action: z.literal("unmap"),
    deductorKey: z.string().trim().min(1).max(240),
  }),
]);

export async function POST(request: Request) {
  const { denied } = await apiGuard("accounts.map");
  if (denied) return denied;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const entity = await getEntity();
  if (entity.isGroup) {
    return NextResponse.json(
      { error: "The consolidated view has no books of its own. Switch to a company first." },
      { status: 400 },
    );
  }

  const body = parsed.data;

  try {
    const result = await transaction(async (client) => {
      if (body.action === "map") {
        // The key is the normalised deductor name, which is exactly what the
        // matcher looks up - storing the raw name would never be found again.
        const key = normaliseParty(body.deductorName);
        if (!key) throw new Error("That deductor name normalises to nothing usable.");

        // Only names the firm actually deals with, so a typo cannot create a
        // customer that exists nowhere else.
        const known = await client.query<{ customer_name: string }>(
          `select 1 as ok from (
             select entity_id, customer_name from invoice_lines
             union select entity_id, customer_name from ar_open_items
             union select entity_id, customer_name from payments) x
            where entity_id = $1 and customer_name = $2 limit 1`,
          [entity.id, body.customerName],
        );
        if (known.rowCount === 0) {
          throw new Error(
            `"${body.customerName}" is not a customer this company has billed, been paid by, or is owed by.`,
          );
        }

        await client.query(
          `insert into tds_deductor_aliases (entity_id, deductor_key, customer_name)
           values ($1, $2, $3)
           on conflict (entity_id, deductor_key)
             do update set customer_name = excluded.customer_name`,
          [entity.id, key, body.customerName],
        );
      } else {
        await client.query(
          "delete from tds_deductor_aliases where entity_id = $1 and deductor_key = $2",
          [entity.id, body.deductorKey],
        );
      }

      return resolveTdsCustomers(client, entity.id);
    });

    return NextResponse.json({ ok: true, matched: result.matched, total: result.total });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not save that mapping.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

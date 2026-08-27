import { query, queryOne } from "@/lib/db";
import { verticalScope, type Entity } from "@/lib/entity";
import { AR_BUCKETS } from "@/lib/reports/drilldowns";

/**
 * One customer's position, from the opening balance to what is still open.
 *
 * Five figures that have to reconcile:
 *
 *   opening + invoiced - collected - credited = closing
 *
 * Only the closing balance is a fact - it is the AR export, invoice by
 * invoice. The other three are movements over the year, and the opening
 * balance is what is left when they are worked back off the closing figure.
 * That is deliberately the direction of the derivation: the AR snapshot is the
 * one number a partner will be challenged on, so it is the one that is
 * reported rather than computed, and any disagreement between the registers
 * lands in the opening balance where it is visible instead of being spread
 * silently across the year.
 *
 * Where the registers do disagree - an invoice raised before the file the AR
 * export was taken from, a receipt against an invoice in no uploaded register -
 * the opening balance carries it. A large opening balance on a customer who is
 * new this year is therefore a data question, not a debt.
 */

export interface CustomerStatement {
  customer: string;
  /** first day of the financial year the movements are measured from */
  from: string;
  /** the AR snapshot date the closing balance is stated at */
  asOf: string;
  opening: number;
  invoiced: number;
  collected: number;
  credited: number;
  closing: number;
  /** open balance by ageing band, keyed as AR_BUCKETS */
  ageing: Record<string, number>;
  openInvoices: number;
  /** true when this customer has no open items in the AR snapshot at all */
  nothingOpen: boolean;
}

const EXCLUDED_STATUS = ["void", "rejected", "draft"];

export async function buildCustomerStatement(opts: {
  entity: Entity;
  customer: string;
  /** first day of the financial year */
  from: string;
  /** the AR snapshot date the page is reporting at */
  asOf: string;
  verticalId?: number | null;
}): Promise<CustomerStatement> {
  const { entity, customer, from, asOf, verticalId = null } = opts;
  const ids = entity.memberIds;

  const ageingSelect = AR_BUCKETS.map(
    (b) => `coalesce(sum(case when ${b.test()} then balance_base else 0 end),0)::numeric as ${b.key}`,
  ).join(", ");

  const [open, invoiced, collected, credited] = await Promise.all([
    queryOne<Record<string, number>>(
      `select ${ageingSelect},
              coalesce(sum(balance_base),0)::numeric as closing,
              count(*)::int as n
         from ar_open_items
        where (entity_id, as_of) in (
                select entity_id, max(as_of) from ar_open_items
                 where entity_id = any($1::int[]) group by entity_id)
          and customer_name = $2
          and ($3::int is null or vertical_id = $3)
          ${verticalScope("$4")}`,
      [ids, customer, verticalId, entity.verticalIds],
    ),
    /**
     * What was billed in the year, fee and reimbursement together. An AR
     * balance is everything unpaid, so a statement that netted the recharges
     * out would not reconcile to it.
     */
    queryOne<{ v: number }>(
      `select coalesce(sum(total_base),0)::numeric v
         from invoice_lines
        where entity_id = any($1::int[]) and invoice_date between $2 and $3
          and customer_name = $4 and not (status = any($5))
          and ($6::int is null or vertical_id = $6)
          ${verticalScope("$7")}`,
      [ids, from, asOf, customer, EXCLUDED_STATUS, verticalId, entity.verticalIds],
    ),
    queryOne<{ v: number }>(
      `select coalesce(sum(a.amount_base),0)::numeric v
         from payment_allocations a join payments p on p.id = a.payment_id
        where a.entity_id = any($1::int[]) and p.payment_date between $2 and $3
          and p.customer_name = $4
          and ($5::int is null or a.vertical_id = $5)
          ${verticalScope("$6", "a.vertical_id")}`,
      [ids, from, asOf, customer, verticalId, entity.verticalIds],
    ),
    queryOne<{ v: number }>(
      `select coalesce(sum(cn_total_base),0)::numeric v
         from credit_notes
        where entity_id = any($1::int[]) and credit_note_date between $2 and $3
          and customer_name = $4 and is_primary_row and not (status = any($5))
          and ($6::int is null or vertical_id = $6)
          ${verticalScope("$7")}`,
      [ids, from, asOf, customer, EXCLUDED_STATUS, verticalId, entity.verticalIds],
    ),
  ]);

  const closing = Number(open?.closing ?? 0);
  const inv = Number(invoiced?.v ?? 0);
  const col = Number(collected?.v ?? 0);
  const cred = Number(credited?.v ?? 0);

  const ageing: Record<string, number> = {};
  for (const b of AR_BUCKETS) ageing[b.key] = Number(open?.[b.key] ?? 0);

  return {
    customer,
    from,
    asOf,
    opening: closing - inv + col + cred,
    invoiced: inv,
    collected: col,
    credited: cred,
    closing,
    ageing,
    openInvoices: Number(open?.n ?? 0),
    nothingOpen: Number(open?.n ?? 0) === 0,
  };
}

/**
 * Every customer worth offering in the picker.
 *
 * Narrowed to the chosen vertical when there is one. Offering a name with no
 * activity in the vertical on screen is offering an empty panel, and the reader
 * has no way to tell that from a customer who genuinely paid nothing.
 */
export async function listCustomers(
  entity: Entity,
  sources: ("ar" | "invoices" | "payments")[],
  verticalId: number | null = null,
) {
  const parts: string[] = [];
  if (sources.includes("ar")) {
    parts.push(`select distinct customer_name from ar_open_items
                 where entity_id = any($1::int[]) and ($2::int is null or vertical_id = $2)`);
  }
  if (sources.includes("invoices")) {
    parts.push(`select distinct customer_name from invoice_lines
                 where entity_id = any($1::int[]) and ($2::int is null or vertical_id = $2)`);
  }
  if (sources.includes("payments")) {
    // A receipt carries no vertical of its own; its allocations do.
    parts.push(`select distinct p.customer_name
                  from payments p
                  join payment_allocations a on a.payment_id = p.id
                 where p.entity_id = any($1::int[]) and ($2::int is null or a.vertical_id = $2)`);
  }
  const rows = await query<{ customer_name: string }>(
    `select customer_name from (${parts.join(" union ")}) c
      where customer_name is not null and customer_name <> ''
      order by customer_name`,
    [entity.memberIds, verticalId],
  );
  return rows.map((r) => r.customer_name);
}

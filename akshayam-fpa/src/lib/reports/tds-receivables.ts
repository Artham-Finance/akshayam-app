import { query } from "@/lib/db";
import { getVerticalsInScope, verticalScope, type Entity } from "@/lib/entity";
import { fyLabel, fyMonths, fyStartYearOf, quarterLabel, type QuarterNo } from "@/lib/period";
import { ROWS, scorecardRowCodeFor } from "@/lib/reports/scorecard";
import { BOOKS_CUSTOMER, TDS_ACCOUNTS, buildTdsReco, tdsQuarterWindow } from "@/lib/reports/tds";

/**
 * The MAK meeting's TDS receivables tab: the TDS held as receivable from
 * customers, year by year, customer by customer, with the vertical each belongs to.
 *
 * Year, vertical, customer and the TDS amount are the loaded sheet's. The invoice
 * (number, date, value - all free text), the observation and the follow-up action
 * are kept by the vertical's head against each row; the 10% of the invoice value is
 * worked out on the screen from whatever value is keyed, never stored.
 *
 * Only the verticals of the signed-in entity are read, which is what limits a
 * vertical's head to their own rows (see 074_tds_receivables.sql).
 *
 * After those sheet years comes the current financial year, invoice by invoice and
 * quarter by quarter - see buildTdsInvoicesByQuarter.
 */

export interface TdsReceivableRow {
  id: number;
  fy: string;
  verticalId: number;
  vertical: string;
  customer: string;
  /** the TDS receivable per the books */
  tdsAmount: number;
  invNumber: string | null;
  invDate: string | null;
  invValue: string | null;
  observation: string | null;
  followUp: string | null;
}

export interface TdsReceivableYear {
  fy: string;
  rows: TdsReceivableRow[];
  total: number;
}

/** One invoice's TDS in a quarter, as the books carry it. */
export interface TdsInvoiceRow {
  entityId: number;
  /** empty where the TDS posting names no invoice */
  invoiceNumber: string;
  invoiceDate: string | null;
  /** the invoice's value, ex tax - null where the invoice is not on the register */
  invoiceAmount: number | null;
  verticalId: number | null;
  vertical: string;
  /** TDS booked on the invoice in the quarter */
  tds: number;
  observation: string | null;
  followUp: string | null;
}

/**
 * A customer's invoices in a quarter. Form 26AS carries no invoice number - only a
 * customer, a date and an amount - so it is compared with the customer's TDS for the
 * quarter as a whole, never guessed down to an invoice.
 */
export interface TdsInvoiceCustomer {
  customer: string;
  invoices: TdsInvoiceRow[];
  /** the customer's TDS booked in the quarter: the sum of its invoices */
  tds: number;
  /** the amount Form 26AS shows for the customer in the quarter - the reconciliation's own figure */
  form26as: number;
  /** TDS minus the amount found in Form 26AS */
  difference: number;
}

export interface TdsInvoiceQuarter {
  quarter: QuarterNo;
  label: string;
  period: { start: string; end: string };
  /** whether Form 26AS has been uploaded to cover this quarter at all */
  has26as: boolean;
  customers: TdsInvoiceCustomer[];
  tds: number;
  form26as: number;
  difference: number;
  /** Form 26AS for customers with no TDS booked in the quarter, so on no row above */
  form26asOther: number;
}

export interface TdsInvoiceYear {
  fyStartYear: number;
  label: string;
  quarters: TdsInvoiceQuarter[];
}

export interface TdsReceivablesResult {
  years: TdsReceivableYear[];
  total: number;
  /** the current year's TDS, invoice by invoice and quarter by quarter */
  invoices: TdsInvoiceYear;
}

interface Row {
  id: number;
  fy: string;
  vertical_id: number;
  customer: string;
  tds_amount: number;
  inv_number: string | null;
  inv_date: string | null;
  inv_value: string | null;
  observation: string | null;
  follow_up: string | null;
}

export async function buildTdsReceivables(opts: {
  entity: Entity;
  /** the week's end: the financial year it falls in is the one listed invoice by invoice */
  weekEnd: string;
}): Promise<TdsReceivablesResult> {
  const { entity, weekEnd } = opts;
  const scoped = await getVerticalsInScope(entity);
  const ids = scoped.map((v) => v.id);
  const rows =
    ids.length === 0
      ? []
      : await query<Row>(
          `select id, fy, vertical_id, customer, tds_amount::float8 as tds_amount,
                  inv_number, inv_date, inv_value, observation, follow_up
             from tds_receivables
            where vertical_id = any($1::int[])
            order by fy, sort_order, id`,
          [ids],
        );

  const labelFor = (id: number) => {
    const v = scoped.find((x) => x.id === id);
    // The scorecard's row for AIF is Raja's AIF and GIFT together; the TDS here is AIF's alone.
    if (v?.code === "AIF") return "Raja - AIF";
    const rowCode = v ? scorecardRowCodeFor(v.code) : null;
    return (rowCode ? ROWS.find((r) => r.code === rowCode)?.label : null) ?? v?.name ?? "Vertical";
  };

  const byYear = new Map<string, TdsReceivableRow[]>();
  for (const r of rows) {
    const list = byYear.get(r.fy) ?? [];
    list.push({
      id: r.id,
      fy: r.fy,
      verticalId: r.vertical_id,
      vertical: labelFor(r.vertical_id),
      customer: r.customer,
      tdsAmount: Number(r.tds_amount),
      invNumber: r.inv_number,
      invDate: r.inv_date,
      invValue: r.inv_value,
      observation: r.observation,
      followUp: r.follow_up,
    });
    byYear.set(r.fy, list);
  }

  // The financial years in order, the earliest first, as the sheet has them.
  const years = [...byYear.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([fy, list]) => ({ fy, rows: list, total: list.reduce((s, r) => s + r.tdsAmount, 0) }));
  return {
    years,
    total: years.reduce((s, y) => s + y.total, 0),
    invoices: await buildTdsInvoicesByQuarter(entity, weekEnd, labelFor),
  };
}

interface InvoiceQueryRow {
  entity_id: number;
  customer: string | null;
  vertical_id: number | null;
  invoice_number: string | null;
  invoice_date: string | null;
  invoice_amount: number | null;
  tds: number;
}

/**
 * The current financial year's TDS receivable, invoice by invoice, a quarter at a time.
 *
 * The invoices and the TDS booked on each are the TDS reconciliation's books side, struck
 * the same way (the TDS ledgers' postings in the quarter, to the invoice they were raised
 * on, the invoice's customer and vertical). The amount found in Form 26AS is the
 * reconciliation's own figure for the customer and quarter, so this list and the
 * reconciliation on the Receivables page can never disagree. A quarter is listed once it
 * has begun, whether or not its Form 26AS has arrived - until then the amount found is nil.
 */
async function buildTdsInvoicesByQuarter(
  entity: Entity,
  weekEnd: string,
  labelFor: (id: number) => string,
): Promise<TdsInvoiceYear> {
  const fyStartYear = fyStartYearOf(new Date(`${weekEnd}T00:00:00`), entity.fy_start_month);
  const months = fyMonths(fyStartYear, entity.fy_start_month);
  const quarters: TdsInvoiceQuarter[] = [];

  for (const quarter of [1, 2, 3, 4] as QuarterNo[]) {
    const period = tdsQuarterWindow(entity, fyStartYear, quarter);
    if (period.start > weekEnd) break;

    const [reco, rows, notes] = await Promise.all([
      buildTdsReco({ entity, fyStartYear, quarter, verticalId: null, customer: null }),
      query<InvoiceQueryRow>(
        `select g.entity_id,
                ${BOOKS_CUSTOMER} as customer,
                coalesce(inv.vertical_id, g.vertical_id) as vertical_id,
                g.txn_number as invoice_number,
                inv.invoice_date::text as invoice_date,
                inv.amount::float8 as invoice_amount,
                sum(g.debit - g.credit)::float8 as tds
           from gl_entries g
           join accounts a on a.id = g.account_id
           left join lateral (
             select i.customer_name, i.vertical_id, i.invoice_date,
                    (select sum(x.amount_base) from invoice_lines x
                      where x.entity_id = g.entity_id and x.invoice_number = g.txn_number) as amount
               from invoice_lines i
              where i.entity_id = g.entity_id and i.invoice_number = g.txn_number
              order by i.id limit 1
           ) inv on true
          where g.entity_id = any($1::int[])
            and g.txn_date between $2 and $3
            and ${TDS_ACCOUNTS}
            ${verticalScope("$4", "coalesce(inv.vertical_id, g.vertical_id)")}
          group by g.entity_id, 2, 3, g.txn_number, inv.invoice_date, inv.amount
         having abs(sum(g.debit - g.credit)) > 0.005
          order by 2, inv.invoice_date, g.txn_number`,
        [entity.memberIds, period.start, period.end, entity.verticalIds],
      ),
      query<{
        entity_id: number;
        customer: string;
        invoice_number: string;
        vertical_id: number;
        observation: string | null;
        follow_up: string | null;
      }>(
        `select entity_id, customer, invoice_number, vertical_id, observation, follow_up
           from tds_invoice_notes
          where entity_id = any($1::int[]) and fy_start_year = $2 and quarter = $3`,
        [entity.memberIds, fyStartYear, quarter],
      ),
    ]);

    const noteOf = new Map(notes.map((n) => [`${n.entity_id}|${n.customer}|${n.invoice_number}|${n.vertical_id}`, n]));
    const form26asOf = new Map(reco.byCustomer.map((c) => [c.label, c.form26as]));

    const byCustomer = new Map<string, TdsInvoiceRow[]>();
    for (const r of rows) {
      const customer = r.customer ?? "Not attributed to a customer";
      const invoiceNumber = r.invoice_number ?? "";
      const note = noteOf.get(`${r.entity_id}|${customer}|${invoiceNumber}|${r.vertical_id ?? 0}`);
      const list = byCustomer.get(customer) ?? [];
      list.push({
        entityId: r.entity_id,
        invoiceNumber,
        invoiceDate: r.invoice_date,
        invoiceAmount: r.invoice_amount === null ? null : Number(r.invoice_amount),
        verticalId: r.vertical_id,
        vertical: r.vertical_id === null ? "Unallocated" : labelFor(r.vertical_id),
        tds: Number(r.tds),
        observation: note?.observation ?? null,
        followUp: note?.follow_up ?? null,
      });
      byCustomer.set(customer, list);
    }

    const customers: TdsInvoiceCustomer[] = [...byCustomer.entries()]
      .map(([customer, invoices]) => {
        const tds = invoices.reduce((s, i) => s + i.tds, 0);
        const form26as = form26asOf.get(customer) ?? 0;
        return { customer, invoices, tds, form26as, difference: tds - form26as };
      })
      .sort((a, b) => b.tds - a.tds || a.customer.localeCompare(b.customer));

    const tds = customers.reduce((s, c) => s + c.tds, 0);
    const form26as = customers.reduce((s, c) => s + c.form26as, 0);
    quarters.push({
      quarter,
      label: quarterLabel(quarter, months),
      period,
      has26as: reco.has26as,
      customers,
      tds,
      form26as,
      difference: tds - form26as,
      form26asOther: reco.totals.form26as - form26as,
    });
  }

  return { fyStartYear, label: fyLabel(fyStartYear), quarters };
}

/**
 * Whether a TDS posting - a customer's invoice in a quarter - is one the signed-in entity
 * may write a note against, and the company it is booked in. Null when it is not in view.
 */
export async function tdsInvoiceEntity(
  entity: Entity,
  fyStartYear: number,
  quarter: QuarterNo,
  customer: string,
  invoiceNumber: string,
  verticalId: number,
): Promise<number | null> {
  const period = tdsQuarterWindow(entity, fyStartYear, quarter);
  const rows = await query<{ entity_id: number }>(
    `select g.entity_id
       from gl_entries g
       join accounts a on a.id = g.account_id
       left join lateral (
         select i.customer_name, i.vertical_id
           from invoice_lines i
          where i.entity_id = g.entity_id and i.invoice_number = g.txn_number
          order by i.id limit 1
       ) inv on true
      where g.entity_id = any($1::int[])
        and g.txn_date between $2 and $3
        and ${TDS_ACCOUNTS}
        and ${BOOKS_CUSTOMER} = $4
        and coalesce(g.txn_number, '') = $5
        and coalesce(inv.vertical_id, g.vertical_id, 0) = $7
        ${verticalScope("$6", "coalesce(inv.vertical_id, g.vertical_id)")}
      group by g.entity_id
     having abs(sum(g.debit - g.credit)) > 0.005
      limit 1`,
    [entity.memberIds, period.start, period.end, customer, invoiceNumber, entity.verticalIds, verticalId],
  );
  return rows[0]?.entity_id ?? null;
}

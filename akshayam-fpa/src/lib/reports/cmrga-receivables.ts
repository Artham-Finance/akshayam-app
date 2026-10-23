import { query, queryOne } from "@/lib/db";
import { getVerticalsInScope, verticalScope, type Entity } from "@/lib/entity";
import { ROWS, scorecardRowCodeFor } from "@/lib/reports/scorecard";

/**
 * CMRGA's receivables, shifted to other verticals (see 076_cmrga_receivable_transfers.sql).
 *
 * Capital Markets Readiness & Governance Assurance no longer continues, and each of its open
 * invoices as at the list date was given to a vertical. Two things follow:
 *
 *  - the MAK meeting's "CMRGA receivables" tab lists the invoices, a vertical seeing only the
 *    ones shifted to it - the same vertical limit every other tab follows;
 *  - a receipt on one of these invoices after the list date is the collection of the vertical
 *    it was shifted to (the ingest credits it there), so that vertical's actual collection is
 *    its own plus what it collects from CMRGA's receivables. `cmrgaCollected` is that second
 *    part, for the footnote that says so.
 */

export interface CmrgaInvoice {
  invoiceNumber: string;
  invoiceDate: string | null;
  dueDate: string | null;
  customer: string;
  /** the age in days, as the shifted list gave it */
  ageDays: number | null;
  invoiceValue: number;
  /** what was open when the receivables were shifted */
  balance: number;
  /** what has come in on the invoice since, up to the week */
  collected: number;
  /** the latest date a receipt came in */
  collectedOn: string | null;
  /** what is still open */
  balanceNow: number;
  /**
   * What the receivables themselves (the AR snapshot, the real data) show open on the invoice
   * at the snapshot date, or null while there is no snapshot dated on or after the shift.
   */
  books: number | null;
  /** the shifted balance less the receipts up to that snapshot date - what `books` should be */
  expected: number;
}

export interface CmrgaVertical {
  verticalId: number;
  label: string;
  invoices: CmrgaInvoice[];
  balance: number;
  collected: number;
  balanceNow: number;
  books: number | null;
  expected: number;
}

/** An invoice on which the receivables and the list disagree. */
export interface CmrgaMismatch {
  invoiceNumber: string;
  customer: string;
  expected: number;
  books: number;
}

export interface CmrgaReceivablesResult {
  /** the date the receivables were shifted as at */
  asOf: string | null;
  verticals: CmrgaVertical[];
  balance: number;
  collected: number;
  balanceNow: number;
  /**
   * The check that the list stays true to the real receivables: the balance the AR snapshot
   * (the GL date's receivables) shows on these invoices, against the shifted balance less what
   * has been collected up to that snapshot. They should always agree.
   */
  check: {
    /** the snapshot compared with; null when none is dated on or after the shift yet */
    booksAsOf: string | null;
    books: number;
    expected: number;
    difference: number;
    mismatches: CmrgaMismatch[];
  };
}

export async function buildCmrgaReceivables(opts: {
  entity: Entity;
  weekEnd: string;
}): Promise<CmrgaReceivablesResult> {
  const { entity, weekEnd } = opts;
  const scoped = await getVerticalsInScope(entity);
  const ids = scoped.map((v) => v.id);
  const rows =
    ids.length === 0
      ? []
      : await query<{
          to_vertical_id: number;
          invoice_number: string;
          invoice_date: string | null;
          due_date: string | null;
          customer_name: string;
          age_days: number | null;
          invoice_value: number;
          balance: number;
          as_of: string;
          collected: number;
          collected_on: string | null;
          books_as_of: string | null;
          books: number | null;
          collected_to_books: number;
        }>(
          // Only the verticals in view: a vertical's head sees what was shifted to them, nobody else's.
          `select t.to_vertical_id, t.invoice_number, t.invoice_date::text, t.due_date::text,
                  t.customer_name, t.age_days, t.invoice_value::float8, t.balance::float8,
                  t.as_of::text,
                  coalesce(r.amount, 0)::float8 as collected, r.last_on::text as collected_on,
                  sn.as_of::text as books_as_of,
                  case when sn.as_of is not null then coalesce(bk.bal, 0)::float8 end as books,
                  coalesce(rb.amount, 0)::float8 as collected_to_books
             from receivable_transfers t
             left join lateral (
               select sum(a.amount_base) as amount, max(p.payment_date) as last_on
                 from payment_allocations a
                 join payments p on p.id = a.payment_id
                where a.entity_id = t.entity_id and a.invoice_number = t.invoice_number
                  and p.payment_date > t.as_of and p.payment_date <= $2
             ) r on true
             -- the receivables snapshot at the GL date: the latest on or before the week, if it is
             -- dated on or after the shift (an older one cannot show the shift's effect)
             left join lateral (
               select max(o.as_of) as as_of
                 from ar_open_items o
                where o.entity_id = t.entity_id and o.as_of <= $2 and o.as_of >= t.as_of
             ) sn on true
             left join lateral (
               select sum(o.balance_base) as bal
                 from ar_open_items o
                where o.entity_id = t.entity_id and o.invoice_number = t.invoice_number
                  and o.as_of = sn.as_of
             ) bk on true
             left join lateral (
               select sum(a.amount_base) as amount
                 from payment_allocations a
                 join payments p on p.id = a.payment_id
                where a.entity_id = t.entity_id and a.invoice_number = t.invoice_number
                  and p.payment_date > t.as_of and p.payment_date <= sn.as_of
             ) rb on true
            where t.entity_id = any($1::int[]) and t.to_vertical_id = any($3::int[])
            order by t.balance desc, t.invoice_number`,
          [entity.memberIds, weekEnd, ids],
        );

  const labelFor = (id: number) => {
    const v = scoped.find((x) => x.id === id);
    const rowCode = v ? scorecardRowCodeFor(v.code) : null;
    return (rowCode ? ROWS.find((r) => r.code === rowCode)?.label : null) ?? v?.name ?? "Vertical";
  };
  const order = (id: number) => {
    const v = scoped.find((x) => x.id === id);
    const code = v ? scorecardRowCodeFor(v.code) : null;
    const i = code ? ROWS.findIndex((r) => r.code === code) : -1;
    return i === -1 ? 999 : i;
  };

  const byVertical = new Map<number, CmrgaInvoice[]>();
  for (const r of rows) {
    const balance = Number(r.balance);
    const collected = Number(r.collected);
    const list = byVertical.get(r.to_vertical_id) ?? [];
    list.push({
      invoiceNumber: r.invoice_number,
      invoiceDate: r.invoice_date,
      dueDate: r.due_date,
      customer: r.customer_name,
      ageDays: r.age_days,
      invoiceValue: Number(r.invoice_value),
      balance,
      collected,
      collectedOn: r.collected_on,
      balanceNow: Math.max(0, balance - collected),
      books: r.books === null ? null : Number(r.books),
      expected: balance - Number(r.collected_to_books),
    });
    byVertical.set(r.to_vertical_id, list);
  }

  const sumBooks = (invoices: CmrgaInvoice[]) =>
    invoices.some((i) => i.books === null) ? null : invoices.reduce((s, i) => s + (i.books ?? 0), 0);

  const verticals: CmrgaVertical[] = [...byVertical.entries()]
    .map(([verticalId, invoices]) => ({
      verticalId,
      label: labelFor(verticalId),
      invoices,
      balance: invoices.reduce((s, i) => s + i.balance, 0),
      collected: invoices.reduce((s, i) => s + i.collected, 0),
      balanceNow: invoices.reduce((s, i) => s + i.balanceNow, 0),
      books: sumBooks(invoices),
      expected: invoices.reduce((s, i) => s + i.expected, 0),
    }))
    .sort((a, b) => order(a.verticalId) - order(b.verticalId) || b.balance - a.balance);

  // The check: the receivables against the list less what has been collected. A paisa of
  // rounding is not a difference.
  const all = verticals.flatMap((v) => v.invoices);
  const booksAsOf = rows.find((r) => r.books_as_of)?.books_as_of ?? null;
  const books = all.reduce((s, i) => s + (i.books ?? 0), 0);
  const expected = booksAsOf ? all.reduce((s, i) => s + i.expected, 0) : 0;
  const mismatches: CmrgaMismatch[] = booksAsOf
    ? all
        .filter((i) => i.books !== null && Math.abs(i.books - i.expected) >= 0.5)
        .map((i) => ({ invoiceNumber: i.invoiceNumber, customer: i.customer, expected: i.expected, books: i.books ?? 0 }))
    : [];

  return {
    asOf: rows[0]?.as_of ?? null,
    verticals,
    balance: verticals.reduce((s, v) => s + v.balance, 0),
    collected: verticals.reduce((s, v) => s + v.collected, 0),
    balanceNow: verticals.reduce((s, v) => s + v.balanceNow, 0),
    check: { booksAsOf, books, expected, difference: books - expected, mismatches },
  };
}

/**
 * What the verticals in view collected, between two dates, on the receivables shifted from
 * CMRGA - fee receipts, so the figure that is part of "actual collection" (reimbursement
 * recoveries are not). Zero where nothing has been shifted to the view, or nothing collected yet.
 */
export async function cmrgaCollected(
  entity: Entity,
  window: { start: string; end: string },
  verticalId: number | null = null,
): Promise<number> {
  const row = await queryOne<{ v: number }>(
    `select coalesce(sum(a.amount_base), 0)::float8 as v
       from receivable_transfers t
       join payment_allocations a
         on a.entity_id = t.entity_id and a.invoice_number = t.invoice_number
       join payments p on p.id = a.payment_id
      where t.entity_id = any($1::int[])
        and not a.is_reimbursement
        and p.payment_date > t.as_of
        and p.payment_date between $2 and $3
        and ($4::int is null or t.to_vertical_id = $4)
        ${verticalScope("$5", "t.to_vertical_id")}`,
    [entity.memberIds, window.start, window.end, verticalId, entity.verticalIds],
  );
  return Number(row?.v ?? 0);
}

/** The same, for each vertical - for the MAK meeting's table, one line under each actual. */
export async function cmrgaCollectedByVertical(
  entity: Entity,
  window: { start: string; end: string },
): Promise<Map<number, number>> {
  const rows = await query<{ vertical_id: number; v: number }>(
    `select t.to_vertical_id as vertical_id, coalesce(sum(a.amount_base), 0)::float8 as v
       from receivable_transfers t
       join payment_allocations a
         on a.entity_id = t.entity_id and a.invoice_number = t.invoice_number
       join payments p on p.id = a.payment_id
      where t.entity_id = any($1::int[])
        and not a.is_reimbursement
        and p.payment_date > t.as_of
        and p.payment_date between $2 and $3
        ${verticalScope("$4", "t.to_vertical_id")}
      group by 1`,
    [entity.memberIds, window.start, window.end, entity.verticalIds],
  );
  return new Map(rows.map((r) => [r.vertical_id, Number(r.v)]));
}

import { query, queryOne } from "@/lib/db";
import { verticalScope, type Entity } from "@/lib/entity";

/**
 * TDS receivable reconciliation: the books against Form 26AS.
 *
 * Two independent records of the same tax credit:
 *
 *   books   a TDS receivable raised when an invoice is approved, either in the
 *           general "TDS Receivable" ledger or a customer-specific
 *           "TDS-2627-<CUSTOMER>" one
 *   26AS    what the customer told the income tax department it deducted
 *
 * They disagree for reasons worth knowing about: a customer deducted but has
 * not yet filed, deducted at the wrong rate, deducted on an invoice the firm
 * has not raised, or the firm booked a credit against the wrong customer. The
 * difference is the report, so nothing is netted away to make it look tidy.
 *
 * The books side gets its customer from the invoice, not from the ledger: the
 * TDS lines carry the invoice number in txn_number, which joins to the invoice
 * register and brings the customer and the vertical with it. The ledger's own
 * description is the fallback for the few that do not join.
 */

/**
 * Only income-tax TDS receivable ledgers.
 *
 * Excluded, and both for reasons that would otherwise plant a permanent
 * unexplainable difference in the reconciliation:
 *
 *   TDS Payable          the other direction entirely - tax the firm deducted
 *                        from its own vendors
 *   TDS on CGST/SGST/IGST  GST TDS under s.51 of the CGST Act, deducted by
 *                        government bodies on the tax component. It is reported
 *                        in GSTR-2A/2B and never appears in Form 26AS, which is
 *                        an income-tax statement, so setting it against 26AS
 *                        compares two different taxes.
 */
const TDS_ACCOUNTS = `
  a.name ~* '^\\s*TDS'
  and a.name !~* 'payable'
  and a.name !~* '(c|s|i)gst'
  and coalesce(a.group_code, '') <> 'other_liab'`;

/**
 * The customer a books-side TDS line belongs to.
 *   1. the invoice it was raised against (also gives the vertical)
 *   2. the customer named in a "TDS-2627-<CUSTOMER>" ledger
 *   3. the line's own description, which Zoho fills with the customer name
 */
const BOOKS_CUSTOMER = `
  coalesce(
    inv.customer_name,
    nullif(btrim(regexp_replace(a.name,
      '^\\s*TDS\\s*[-_ ]*\\s*(26\\s*-?\\s*27|2627|26\\s*-?\\s*27)?\\s*[-_ ]*\\s*', '', 'i')), ''),
    nullif(btrim(g.description), '')
  )`;

/**
 * Where a customer sits once both sides are lined up.
 *
 *   matched     both sides present and agreeing - nothing to do
 *   difference  both sides present and disagreeing - the cases to work through
 *   books_only  a receivable raised that the department has no record of
 *   ret_only    a deduction the department recorded that the books never raised
 */
export type TdsSegment = "matched" | "difference" | "books_only" | "ret_only";

/** Below this, a difference is rounding rather than a discrepancy. */
export const TDS_TOLERANCE = 1;

export function tdsSegmentOf(books: number, form26as: number): TdsSegment {
  const hasBooks = Math.abs(books) >= TDS_TOLERANCE;
  const has26as = Math.abs(form26as) >= TDS_TOLERANCE;
  if (hasBooks && !has26as) return "books_only";
  if (!hasBooks && has26as) return "ret_only";
  return Math.abs(books - form26as) < TDS_TOLERANCE ? "matched" : "difference";
}

export const TDS_SEGMENT_LABEL: Record<TdsSegment, string> = {
  matched: "Matched — books agree with Form 26AS",
  difference: "Difference between books and Form 26AS",
  books_only: "In books, not in Form 26AS",
  ret_only: "In Form 26AS, not in books",
};

export interface TdsRecoRow {
  key: string;
  label: string;
  verticalId: number | null;
  verticalCode: string | null;
  books: number;
  form26as: number;
  difference: number;
  segment: TdsSegment;
}

export interface TdsSegmentSummary {
  segment: TdsSegment;
  label: string;
  customers: number;
  books: number;
  form26as: number;
  difference: number;
}

/** One TDS ledger and what it contributed, so the books figure can be traced. */
export interface TdsLedgerBasis {
  ledger: string;
  amount: number;
  lines: number;
}

export interface TdsUnmatchedDeductor {
  deductorName: string;
  tan: string | null;
  taxDeducted: number;
  lines: number;
}

export interface TdsReco {
  period: { start: string; end: string } | null;
  updatedTill: string | null;
  totals: { books: number; form26as: number; difference: number };
  byCustomer: TdsRecoRow[];
  byVertical: TdsRecoRow[];
  segments: TdsSegmentSummary[];
  /** the ledgers making up the books figure, largest first */
  ledgers: TdsLedgerBasis[];
  unmatchedDeductors: TdsUnmatchedDeductor[];
  /** books-side TDS that could not be tied to a customer name at all */
  booksUnattributed: number;
  hasData: boolean;
}

interface Scope {
  entity: Entity;
  verticalId: number | null;
  customer: string | null;
}

/** The span the loaded statements cover; the reconciliation is only meaningful over it. */
export async function tdsPeriod(entity: Entity) {
  return queryOne<{ start: string; end: string; updated_till: string | null }>(
    `select min(transaction_date)::text as start,
            max(transaction_date)::text as end,
            max(updated_till)::text     as updated_till
       from tds_entries
      where entity_id = any($1::int[]) and transaction_date is not null`,
    [entity.memberIds],
  );
}

export async function buildTdsReco({ entity, verticalId, customer }: Scope): Promise<TdsReco> {
  const period = await tdsPeriod(entity);
  if (!period?.start) {
    return {
      period: null,
      updatedTill: null,
      totals: { books: 0, form26as: 0, difference: 0 },
      byCustomer: [],
      byVertical: [],
      segments: [],
      ledgers: [],
      unmatchedDeductors: [],
      booksUnattributed: 0,
      hasData: false,
    };
  }

  const args = [entity.memberIds, period.start, period.end, verticalId, entity.verticalIds, customer];

  /*
    Both sides are reduced to (customer, vertical, amount) and then joined on the
    customer, so a customer present on one side only still appears - with a
    difference equal to its whole balance, which is exactly the case worth
    looking at.
  */
  const rows = await query<{
    customer: string | null;
    vertical_id: number | null;
    vertical_code: string | null;
    books: number;
    form26as: number;
  }>(
    `with books as (
       select ${BOOKS_CUSTOMER} as customer,
              coalesce(inv.vertical_id, g.vertical_id) as vertical_id,
              sum(g.debit - g.credit)::numeric as amount
         from gl_entries g
         join accounts a on a.id = g.account_id
         left join lateral (
           select i.customer_name, i.vertical_id
             from invoice_lines i
            where i.entity_id = g.entity_id and i.invoice_number = g.txn_number
            limit 1
         ) inv on true
        where g.entity_id = any($1::int[])
          and g.txn_date between $2 and $3
          and ${TDS_ACCOUNTS}
        group by 1, 2
     ),
     statement as (
       select customer_name as customer, vertical_id,
              sum(tax_deducted)::numeric as amount
         from tds_entries
        where entity_id = any($1::int[])
          and transaction_date between $2 and $3
        group by 1, 2
     ),
     combined as (
       select coalesce(b.customer, s.customer)       as customer,
              coalesce(b.vertical_id, s.vertical_id) as vertical_id,
              coalesce(b.amount, 0)                  as books,
              coalesce(s.amount, 0)                  as form26as
         from books b
         full outer join statement s
           on s.customer = b.customer
          and s.vertical_id is not distinct from b.vertical_id
     )
     select c.customer, c.vertical_id, v.code as vertical_code,
            sum(c.books)::numeric   as books,
            sum(c.form26as)::numeric as form26as
       from combined c
       left join verticals v on v.id = c.vertical_id
      where ($4::int is null or c.vertical_id = $4)
        ${verticalScope("$5", "c.vertical_id")}
        and ($6::text is null or c.customer = $6)
      group by c.customer, c.vertical_id, v.code
      having abs(sum(c.books)) > 0.005 or abs(sum(c.form26as)) > 0.005
      order by abs(sum(c.books) - sum(c.form26as)) desc, sum(c.form26as) desc`,
    args,
  );

  /** Customer and vertical together - the grain the vertical view needs. */
  const byCustomerVertical: TdsRecoRow[] = rows.map((r) => ({
    key: `${r.customer ?? "(unattributed)"}|${r.vertical_id ?? 0}`,
    label: r.customer ?? "Not attributed to a customer",
    verticalId: r.vertical_id,
    verticalCode: r.vertical_code,
    books: Number(r.books),
    form26as: Number(r.form26as),
    difference: Number(r.books) - Number(r.form26as),
    segment: tdsSegmentOf(Number(r.books), Number(r.form26as)),
  }));

  /*
    The customer view is one row per customer, not per customer and vertical.

    A single TDS credit cannot be split across verticals, so the 26AS side puts
    a customer's whole deduction on the vertical that billed them most. When the
    books spread that customer's work over two verticals, comparing at the finer
    grain invents two equal and opposite differences that cancel - the customer
    looks doubly wrong while actually reconciling. Aggregating to the customer is
    the only grain at which both sides mean the same thing.
  */
  const customerTotals = new Map<string, TdsRecoRow & { verticals: Set<string> }>();
  for (const row of byCustomerVertical) {
    const existing = customerTotals.get(row.label);
    if (existing) {
      existing.books += row.books;
      existing.form26as += row.form26as;
      existing.difference += row.difference;
      if (row.verticalCode) existing.verticals.add(row.verticalCode);
      // Two verticals means no single one to name or filter to.
      if (existing.verticals.size > 1) {
        existing.verticalId = null;
        existing.verticalCode = `${existing.verticals.size} verticals`;
      }
    } else {
      customerTotals.set(row.label, {
        ...row,
        key: row.label,
        verticals: new Set(row.verticalCode ? [row.verticalCode] : []),
      });
    }
  }

  const byCustomer: TdsRecoRow[] = [...customerTotals.values()]
    .map(({ verticals: _verticals, ...row }) => ({
      ...row,
      segment: tdsSegmentOf(row.books, row.form26as),
    }))
    .sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference) || b.form26as - a.form26as);

  const verticalTotals = new Map<string, TdsRecoRow>();
  for (const row of byCustomerVertical) {
    const key = row.verticalCode ?? "(none)";
    const existing = verticalTotals.get(key);
    if (existing) {
      existing.books += row.books;
      existing.form26as += row.form26as;
      existing.difference += row.difference;
    } else {
      verticalTotals.set(key, {
        key,
        label: row.verticalCode ?? "Unallocated",
        verticalId: row.verticalId,
        verticalCode: row.verticalCode,
        books: row.books,
        form26as: row.form26as,
        difference: row.difference,
        segment: row.segment,
      });
    }
  }

  /*
    The same customers, grouped by whether the two records agree. Every customer
    on the reconciliation falls in exactly one segment, so the four sum back to
    the totals - which is what makes it a way of working through the difference
    rather than another view of it.
  */
  const segmentOrder: TdsSegment[] = ["matched", "difference", "books_only", "ret_only"];
  const segments: TdsSegmentSummary[] = segmentOrder.map((segment) => {
    const rows = byCustomer.filter((r) => r.segment === segment);
    return {
      segment,
      label: TDS_SEGMENT_LABEL[segment],
      customers: rows.length,
      books: rows.reduce((s, r) => s + r.books, 0),
      form26as: rows.reduce((s, r) => s + r.form26as, 0),
      difference: rows.reduce((s, r) => s + r.difference, 0),
    };
  });

  /*
    Which ledgers the books figure is drawn from. Stated on the card because
    "TDS per books" is a number assembled from several accounts, and a reader
    checking it against Zoho needs to know which ones were swept in.
  */
  const ledgerRows = await query<{ ledger: string; amount: number; lines: number }>(
    `select a.name as ledger,
            sum(g.debit - g.credit)::numeric as amount,
            count(*)::int as lines
       from gl_entries g
       join accounts a on a.id = g.account_id
       left join lateral (
         select i.vertical_id from invoice_lines i
          where i.entity_id = g.entity_id and i.invoice_number = g.txn_number limit 1
       ) inv on true
      where g.entity_id = any($1::int[])
        and g.txn_date between $2 and $3
        and ${TDS_ACCOUNTS}
        and ($4::int is null or coalesce(inv.vertical_id, g.vertical_id) = $4)
        ${verticalScope("$5", "coalesce(inv.vertical_id, g.vertical_id)")}
      group by a.name
      having abs(sum(g.debit - g.credit)) > 0.005
      order by abs(sum(g.debit - g.credit)) desc`,
    [entity.memberIds, period.start, period.end, verticalId, entity.verticalIds],
  );

  const unmatchedDeductors = await query<{
    deductor_name: string;
    tan: string | null;
    tax_deducted: number;
    lines: number;
  }>(
    `select deductor_name, max(tan) as tan,
            sum(tax_deducted)::numeric as tax_deducted, count(*)::int as lines
       from tds_entries
      where entity_id = any($1::int[])
        and transaction_date between $2 and $3
        and customer_name is null
      group by deductor_name
      order by tax_deducted desc`,
    [entity.memberIds, period.start, period.end],
  );

  const totals = byCustomer.reduce(
    (acc, r) => ({
      books: acc.books + r.books,
      form26as: acc.form26as + r.form26as,
      difference: acc.difference + r.difference,
    }),
    { books: 0, form26as: 0, difference: 0 },
  );

  return {
    period: { start: period.start, end: period.end },
    updatedTill: period.updated_till,
    totals,
    byCustomer,
    segments,
    ledgers: ledgerRows.map((r) => ({
      ledger: r.ledger,
      amount: Number(r.amount),
      lines: r.lines,
    })),
    byVertical: [...verticalTotals.values()].sort(
      (a, b) => Math.abs(b.difference) - Math.abs(a.difference),
    ),
    unmatchedDeductors: unmatchedDeductors.map((r) => ({
      deductorName: r.deductor_name,
      tan: r.tan,
      taxDeducted: Number(r.tax_deducted),
      lines: r.lines,
    })),
    booksUnattributed: byCustomer
      .filter((r) => r.label === "Not attributed to a customer")
      .reduce((s, r) => s + r.books, 0),
    hasData: true,
  };
}

/* ============================================================
   Workings behind a figure
   ============================================================ */

export type TdsDrillSide = "books" | "26as" | "invoice";

export interface TdsDrillResult {
  columns: { header: string; type: string; strong?: boolean }[];
  rows: (string | number | null)[][];
  total: number;
}

/** The individual lines behind one customer's books or 26AS figure. */
export async function tdsDrill(
  entity: Entity,
  side: TdsDrillSide,
  customer: string,
  limit = 250,
): Promise<TdsDrillResult | null> {
  const period = await tdsPeriod(entity);
  if (!period?.start) return null;

  /*
    Invoice by invoice, which is how a partner reads a customer's TDS: what was
    billed, what was withheld against it, and at what rate. Form 26AS carries no
    invoice number - only a transaction date and an amount - so it cannot be put
    on these lines without inventing a link. The rate column is the point: a
    deduction at 2% where the ledger expects 10% shows up here and nowhere else.
  */
  if (side === "invoice") {
    const rows = await query<Record<string, string | number | null>>(
      `select i.invoice_date::text as d,
              i.invoice_number,
              sum(i.amount_base)::numeric as billed,
              coalesce(t.tds, 0)::numeric as tds
         from invoice_lines i
         left join lateral (
           select sum(g.debit - g.credit) as tds
             from gl_entries g
             join accounts a on a.id = g.account_id
            where g.entity_id = i.entity_id
              and g.txn_number = i.invoice_number
              and ${TDS_ACCOUNTS}
         ) t on true
        where i.entity_id = any($1::int[])
          and i.invoice_date between $2 and $3
          and i.customer_name = $4
        group by i.invoice_date, i.invoice_number, t.tds
        order by i.invoice_date, i.invoice_number
        limit $5`,
      [entity.memberIds, period.start, period.end, customer, limit],
    );

    return {
      columns: [
        { header: "Invoice date", type: "date" },
        { header: "Invoice", type: "text" },
        { header: "Billed (ex tax)", type: "money" },
        { header: "TDS booked", type: "money", strong: true },
        { header: "Rate", type: "percent" },
      ],
      rows: rows.map((r) => {
        const billed = Number(r.billed);
        const tds = Number(r.tds);
        return [
          r.d,
          r.invoice_number,
          billed,
          tds,
          billed > 0 ? (tds / billed) * 100 : null,
        ];
      }),
      total: rows.reduce((s, r) => s + Number(r.tds), 0),
    };
  }

  if (side === "26as") {
    const rows = await query<Record<string, string | number | null>>(
      `select transaction_date::text as d, deductor_name, tan, section,
              booking_status, amount_credited, tax_deducted
         from tds_entries
        where entity_id = any($1::int[])
          and transaction_date between $2 and $3
          and customer_name = $4
        order by tax_deducted desc limit $5`,
      [entity.memberIds, period.start, period.end, customer, limit],
    );
    return {
      columns: [
        { header: "Date", type: "date" },
        { header: "Deductor", type: "text" },
        { header: "TAN", type: "text" },
        { header: "Section", type: "text" },
        { header: "Booking", type: "text" },
        { header: "Amount credited", type: "money" },
        { header: "TDS", type: "money", strong: true },
      ],
      rows: rows.map((r) => [
        r.d, r.deductor_name, r.tan, r.section, r.booking_status,
        Number(r.amount_credited), Number(r.tax_deducted),
      ]),
      total: rows.reduce((s, r) => s + Number(r.tax_deducted), 0),
    };
  }

  const rows = await query<Record<string, string | number | null>>(
    `select g.txn_date::text as d, a.name as ledger, g.txn_number as invoice,
            g.description, (g.debit - g.credit)::numeric as amount
       from gl_entries g
       join accounts a on a.id = g.account_id
       left join lateral (
         select i.customer_name from invoice_lines i
          where i.entity_id = g.entity_id and i.invoice_number = g.txn_number limit 1
       ) inv on true
      where g.entity_id = any($1::int[])
        and g.txn_date between $2 and $3
        and ${TDS_ACCOUNTS}
        and ${BOOKS_CUSTOMER} = $4
      order by (g.debit - g.credit) desc limit $5`,
    [entity.memberIds, period.start, period.end, customer, limit],
  );

  return {
    columns: [
      { header: "Date", type: "date" },
      { header: "Ledger", type: "text" },
      { header: "Invoice", type: "text" },
      { header: "Narration", type: "text" },
      { header: "TDS booked", type: "money", strong: true },
    ],
    rows: rows.map((r) => [r.d, r.ledger, r.invoice, r.description, Number(r.amount)]),
    total: rows.reduce((s, r) => s + Number(r.amount), 0),
  };
}

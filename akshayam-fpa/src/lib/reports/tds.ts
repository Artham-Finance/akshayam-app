import { query, queryOne } from "@/lib/db";
import { verticalScope, type Entity } from "@/lib/entity";
import { fyMonths, quarterLabel as quarterLabelOf, type QuarterNo } from "@/lib/period";

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
 *
 * Struck one financial-year quarter at a time, never blended. Form 26AS is
 * downloaded from the income tax portal once a quarter, so the two sides only
 * ever mean the same window when the window is a quarter - a range spanning
 * two would compare a whole 26AS filing against a partial one. The books side
 * is read for the quarter regardless of whether that quarter's 26AS has been
 * uploaded yet: a quarter with nothing in tds_entries still shows its books
 * TDS, every customer falling into "in books, not in Form 26AS" until the
 * statement arrives - which is the fact worth showing, not something to hide
 * behind an empty card.
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
 *   TDS-2526-<CUSTOMER>  a customer ledger for FY 2025-26. The credit belongs
 *                        to the prior year's Form 26AS, not this one, so it is
 *                        left out rather than set against a statement that will
 *                        never carry it. Only the year-tagged prior-year ledgers
 *                        are dropped - the general "TDS Receivable" and the
 *                        current-year "TDS-2627-<CUSTOMER>" ledgers stay.
 */
const TDS_ACCOUNTS = `
  a.name ~* '^\\s*TDS'
  and a.name !~* 'payable'
  and a.name !~* '(c|s|i)gst'
  and coalesce(a.group_code, '') <> 'other_liab'
  and a.name !~* '^\\s*TDS\\s*[-_ ]*\\s*(2526|25\\s*-\\s*26)([^0-9]|$)'`;

/**
 * The customer a books-side TDS line belongs to.
 *   1. the invoice it was raised against (also gives the vertical)
 *   2. the customer named in a "TDS-2627-<CUSTOMER>" ledger
 *   3. the line's own description, which Zoho fills with the customer name
 */
const BOOKS_CUSTOMER = `
  coalesce(
    inv.customer_name,
    nullif(btrim(g.description), ''),
    /*
      A customer-specific ledger names its customer after "TDS" and a financial
      year: "TDS-2627-ANICUT CAPITAL", "TDS - 2526 - AK Law Chambers". The year
      is stripped for any year, not just the current one - leaving "2526-" on
      the front makes the name match nothing and strands the credit in
      Unallocated. What remains is only a customer name if something is left of
      it: the generic "TDS Receivable" ledger reduces to "Receivable", which is
      a ledger, not a party.
    */
    nullif(
      case
        when lower(btrim(regexp_replace(a.name,
               '^\\s*TDS\\s*[-_ ]*\\s*((\\d{2}\\s*-\\s*\\d{2})|(\\d{4}))?\\s*[-_ ]*\\s*', '', 'i')))
             in ('receivable', 'receivables', 'recoverable', 'receivable a/c', '')
        then null
        else btrim(regexp_replace(a.name,
               '^\\s*TDS\\s*[-_ ]*\\s*((\\d{2}\\s*-\\s*\\d{2})|(\\d{4}))?\\s*[-_ ]*\\s*', '', 'i'))
      end, '')
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
  /**
   * Why the TDS entry is not in Zoho, or whatever else explains this
   * customer's gap - free text, kept per (entity, FY, quarter, customer).
   * Only set on `byCustomer` rows; the vertical and unallocated views group
   * differently and a remark keyed to one customer would read as belonging
   * to whichever customer happened to be folded in first.
   */
  remark: string | null;
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
  quarter: QuarterNo;
  quarterLabel: string;
  period: { start: string; end: string };
  /** whether Form 26AS has been uploaded to cover this quarter at all */
  has26as: boolean;
  updatedTill: string | null;
  totals: { books: number; form26as: number; difference: number };
  byCustomer: TdsRecoRow[];
  byVertical: TdsRecoRow[];
  segments: TdsSegmentSummary[];
  /** the ledgers making up the books figure, largest first */
  ledgers: TdsLedgerBasis[];
  unmatchedDeductors: TdsUnmatchedDeductor[];
  /**
   * The customers behind the "Unallocated" vertical line - TDS on either side
   * that no vertical could be attributed to. Kept at the customer-and-vertical
   * grain the vertical table is built from, so it foots to that row rather
   * than to the customer table, which groups differently.
   */
  unallocated: TdsRecoRow[];
  /** books-side TDS that could not be tied to a customer name at all */
  booksUnattributed: number;
  /**
   * The invoice and date behind every "in books, not in Form 26AS" customer,
   * one row per invoice rather than per customer - a customer can carry more
   * than one. Across every vertical; narrowed only by the vertical filter the
   * rest of the card is narrowed by.
   */
  booksOnlyInvoices: TdsBooksOnlyInvoiceRow[];
  /** true once there is anything at all to show for the quarter - books or 26AS */
  hasData: boolean;
}

export interface TdsBooksOnlyInvoiceRow {
  customer: string;
  verticalId: number | null;
  verticalCode: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  amount: number;
}

interface Scope {
  entity: Entity;
  fyStartYear: number;
  quarter: QuarterNo;
  verticalId: number | null;
  customer: string | null;
}

/** The calendar dates one financial-year quarter covers, for this entity's FY start month. */
export function tdsQuarterWindow(
  entity: Pick<Entity, "fy_start_month">,
  fyStartYear: number,
  quarter: QuarterNo,
): { start: string; end: string } {
  const months = fyMonths(fyStartYear, entity.fy_start_month).filter((m) => m.quarter === quarter);
  return { start: months[0].start, end: months[months.length - 1].end };
}

export async function buildTdsReco({
  entity,
  fyStartYear,
  quarter,
  verticalId,
  customer,
}: Scope): Promise<TdsReco> {
  const period = tdsQuarterWindow(entity, fyStartYear, quarter);
  const label = quarterLabelOf(quarter, fyMonths(fyStartYear, entity.fy_start_month));

  // Whether Form 26AS has been uploaded to cover this quarter at all - the
  // fact the rest of the card, and the page above it, reads off.
  const coverage = await queryOne<{ rows: number; updated_till: string | null }>(
    `select count(*)::int as rows, max(updated_till)::text as updated_till
       from tds_entries
      where entity_id = any($1::int[]) and transaction_date between $2 and $3`,
    [entity.memberIds, period.start, period.end],
  );
  const has26as = (coverage?.rows ?? 0) > 0;

  // Remarks are written against the entity actually being looked at, not
  // its member ids - a note is someone's own account of what they found,
  // and a slice has no reconciliation of its own to write one against.
  const remarkRows = await query<{ customer: string; remark: string }>(
    `select customer, remark from tds_remarks
      where entity_id = $1 and fy_start_year = $2 and quarter = $3`,
    [entity.id, fyStartYear, quarter],
  );
  const remarkByCustomer = new Map(remarkRows.map((r) => [r.customer, r.remark]));

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
    remark: null,
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
      remark: remarkByCustomer.get(row.label) ?? null,
    }))
    .sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference) || b.form26as - a.form26as);

  /* The Unallocated vertical line, opened up by customer. */
  const unallocatedByCustomer = new Map<string, TdsRecoRow>();
  for (const row of byCustomerVertical) {
    if (row.verticalId !== null) continue;
    const existing = unallocatedByCustomer.get(row.label);
    if (existing) {
      existing.books += row.books;
      existing.form26as += row.form26as;
      existing.difference += row.difference;
      existing.segment = tdsSegmentOf(existing.books, existing.form26as);
    } else {
      unallocatedByCustomer.set(row.label, { ...row, key: row.label });
    }
  }

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
        remark: null,
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
    Invoice and date behind "In books, not in Form 26AS" - the segment with
    the most names to chase, and the one a reader always ends up asking "which
    invoice was this" about. One row per invoice rather than per customer,
    since a customer can carry more than one; fetched only for that segment's
    own customers, across every vertical, narrowed only by the picker's own
    vertical filter.
  */
  const booksOnlyCustomers = byCustomer
    .filter((r) => r.segment === "books_only")
    .map((r) => r.label);

  const booksOnlyRows =
    booksOnlyCustomers.length === 0
      ? []
      : await query<{
          customer: string | null;
          vertical_id: number | null;
          vertical_code: string | null;
          invoice_number: string | null;
          invoice_date: string | null;
          amount: number;
        }>(
          `select ${BOOKS_CUSTOMER} as customer,
                  coalesce(inv.vertical_id, g.vertical_id) as vertical_id,
                  v.code as vertical_code,
                  g.txn_number as invoice_number,
                  inv.invoice_date::text as invoice_date,
                  sum(g.debit - g.credit)::numeric as amount
             from gl_entries g
             join accounts a on a.id = g.account_id
             left join lateral (
               select i.customer_name, i.vertical_id, i.invoice_date
                 from invoice_lines i
                where i.entity_id = g.entity_id and i.invoice_number = g.txn_number
                limit 1
             ) inv on true
             left join verticals v on v.id = coalesce(inv.vertical_id, g.vertical_id)
            where g.entity_id = any($1::int[])
              and g.txn_date between $2 and $3
              and ${TDS_ACCOUNTS}
              and ${BOOKS_CUSTOMER} = any($4::text[])
              and ($5::int is null or coalesce(inv.vertical_id, g.vertical_id) = $5)
              ${verticalScope("$6", "coalesce(inv.vertical_id, g.vertical_id)")}
            group by 1, 2, 3, g.txn_number, inv.invoice_date
           having abs(sum(g.debit - g.credit)) > 0.005
           order by 1, inv.invoice_date`,
          [
            entity.memberIds,
            period.start,
            period.end,
            booksOnlyCustomers,
            verticalId,
            entity.verticalIds,
          ],
        );

  const booksOnlyInvoices: TdsBooksOnlyInvoiceRow[] = booksOnlyRows.map((r) => ({
    customer: r.customer ?? "Not attributed to a customer",
    verticalId: r.vertical_id,
    verticalCode: r.vertical_code,
    invoiceNumber: r.invoice_number,
    invoiceDate: r.invoice_date,
    amount: Number(r.amount),
  }));

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
    quarter,
    quarterLabel: label,
    period: { start: period.start, end: period.end },
    has26as,
    updatedTill: coverage?.updated_till ?? null,
    totals,
    byCustomer,
    segments,
    ledgers: ledgerRows.map((r) => ({
      ledger: r.ledger,
      amount: Number(r.amount),
      lines: r.lines,
    })),
    unallocated: [...unallocatedByCustomer.values()].sort(
      (x, y) => Math.abs(y.difference) - Math.abs(x.difference) || y.form26as - x.form26as,
    ),
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
    booksOnlyInvoices,
    hasData: byCustomer.length > 0,
  };
}

/* ============================================================
   The whole reconciliation, invoice by invoice - for the download
   ============================================================ */

export interface TdsExportBooksRow {
  segment: TdsSegment;
  customer: string;
  verticalCode: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  amount: number;
}

export interface TdsExportEntryRow {
  segment: TdsSegment;
  customer: string;
  deductorName: string | null;
  tan: string | null;
  section: string | null;
  transactionDate: string | null;
  amountCredited: number;
  taxDeducted: number;
}

export interface TdsRecoExport {
  quarterLabel: string;
  period: { start: string; end: string };
  /** the same customer-level reconciliation the card shows, for the summary sheet */
  summary: TdsRecoRow[];
  /** every books-side invoice for the quarter, not just one segment's */
  books: TdsExportBooksRow[];
  /** every Form 26AS entry for the quarter, not just one segment's */
  form26as: TdsExportEntryRow[];
}

/**
 * The whole reconciliation at invoice grain, for the Excel download - every
 * customer's books invoices and 26AS entries, each tagged with the segment
 * its customer falls into, so the workbook can be read the same way the
 * card is: matched, needs chasing, or the other way round.
 *
 * `booksOnlyInvoices` on `TdsReco` only ever covered one segment, because
 * that is the only invoice list the card itself opens. The download is a
 * different reader's need - not "what's still open" but "show me
 * everything", so it re-reads both sides for every customer instead.
 */
export async function buildTdsRecoExport(
  scope: Scope,
  opts: { segment?: TdsSegment | null } = {},
): Promise<TdsRecoExport> {
  const { entity, verticalId } = scope;
  const onlySegment = opts.segment ?? null;
  const reco = await buildTdsReco(scope);
  const { period } = reco;
  const segmentByCustomer = new Map(reco.byCustomer.map((r) => [r.label, r.segment]));
  const segmentFor = (customer: string | null) =>
    segmentByCustomer.get(customer ?? "Not attributed to a customer") ?? "books_only";

  const booksRows = await query<{
    customer: string | null;
    vertical_code: string | null;
    invoice_number: string | null;
    invoice_date: string | null;
    amount: number;
  }>(
    `select ${BOOKS_CUSTOMER} as customer,
            v.code as vertical_code,
            g.txn_number as invoice_number,
            inv.invoice_date::text as invoice_date,
            sum(g.debit - g.credit)::numeric as amount
       from gl_entries g
       join accounts a on a.id = g.account_id
       left join lateral (
         select i.customer_name, i.vertical_id, i.invoice_date
           from invoice_lines i
          where i.entity_id = g.entity_id and i.invoice_number = g.txn_number
          limit 1
       ) inv on true
       left join verticals v on v.id = coalesce(inv.vertical_id, g.vertical_id)
      where g.entity_id = any($1::int[])
        and g.txn_date between $2 and $3
        and ${TDS_ACCOUNTS}
        and ($4::int is null or coalesce(inv.vertical_id, g.vertical_id) = $4)
        ${verticalScope("$5", "coalesce(inv.vertical_id, g.vertical_id)")}
      group by 1, 2, g.txn_number, inv.invoice_date
     having abs(sum(g.debit - g.credit)) > 0.005
     order by 1, inv.invoice_date`,
    [entity.memberIds, period.start, period.end, verticalId, entity.verticalIds],
  );

  const entryRows = await query<{
    customer_name: string | null;
    deductor_name: string | null;
    tan: string | null;
    section: string | null;
    transaction_date: string | null;
    amount_credited: number;
    tax_deducted: number;
  }>(
    `select t.customer_name, t.deductor_name, t.tan, t.section,
            t.transaction_date::text as transaction_date,
            t.amount_credited::numeric as amount_credited,
            t.tax_deducted::numeric as tax_deducted
       from tds_entries t
      where t.entity_id = any($1::int[])
        and t.transaction_date between $2 and $3
        and ($4::int is null or t.vertical_id = $4)
        ${verticalScope("$5", "t.vertical_id")}
      order by t.customer_name nulls last, t.transaction_date`,
    [entity.memberIds, period.start, period.end, verticalId, entity.verticalIds],
  );

  const summary = onlySegment
    ? reco.byCustomer.filter((r) => r.segment === onlySegment)
    : reco.byCustomer;
  const books = booksRows
    .map((r) => ({
      segment: segmentFor(r.customer),
      customer: r.customer ?? "Not attributed to a customer",
      verticalCode: r.vertical_code,
      invoiceNumber: r.invoice_number,
      invoiceDate: r.invoice_date,
      amount: Number(r.amount),
    }))
    .filter((r) => !onlySegment || r.segment === onlySegment);
  const form26as = entryRows
    .map((r) => ({
      segment: segmentFor(r.customer_name),
      customer: r.customer_name ?? "Not attributed to a customer",
      deductorName: r.deductor_name,
      tan: r.tan,
      section: r.section,
      transactionDate: r.transaction_date,
      amountCredited: Number(r.amount_credited),
      taxDeducted: Number(r.tax_deducted),
    }))
    .filter((r) => !onlySegment || r.segment === onlySegment);

  return { quarterLabel: reco.quarterLabel, period, summary, books, form26as };
}

/* ============================================================
   Workings behind a figure
   ============================================================ */

export type TdsDrillSide = "books" | "26as" | "invoice";

export interface TdsDrillResult {
  columns: { header: string; type: string; strong?: boolean }[];
  rows: (string | number | null)[][];
  total: number;
  /**
   * Set only for `side: "invoice"` - the same customer's Form 26AS entries,
   * shown alongside the invoice list so a "difference" or "in Form 26AS, not
   * in books" customer can be read both ways at once. 26AS carries no
   * invoice number, so this is the closest a reader gets to lining the two
   * up without inventing a link that is not really there.
   */
  secondary?: { title: string; result: TdsDrillResult };
}

/** Form 26AS's own entries for one customer - shared by `side: "26as"` and, alongside the invoice list, `side: "invoice"`. */
async function tds26asRows(
  entity: Entity,
  period: { start: string; end: string },
  customer: string,
  limit: number,
): Promise<TdsDrillResult> {
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

/** The individual lines behind one customer's books or 26AS figure, for one quarter. */
export async function tdsDrill(
  entity: Entity,
  fyStartYear: number,
  quarter: QuarterNo,
  side: TdsDrillSide,
  customer: string,
  limit = 250,
): Promise<TdsDrillResult | null> {
  const period = tdsQuarterWindow(entity, fyStartYear, quarter);

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

    const secondary26as = await tds26asRows(entity, period, customer, limit);

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
      // Only worth showing beside the invoice list when there is something on
      // that side to compare against - an empty table would just read as
      // "26AS was checked and carries nothing", which the segment already says.
      secondary:
        secondary26as.rows.length > 0
          ? { title: "Form 26AS entries for this customer", result: secondary26as }
          : undefined,
    };
  }

  if (side === "26as") {
    return tds26asRows(entity, period, customer, limit);
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

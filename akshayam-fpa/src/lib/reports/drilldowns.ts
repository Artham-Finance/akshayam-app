import { query, queryOne } from "@/lib/db";
import { verticalScope, type Entity } from "@/lib/entity";

/**
 * The documents behind a headline figure.
 *
 * One definition, used by both the on-screen drill-down and the Excel export.
 * They were briefly two, and that is exactly how a download comes to disagree
 * with the screen it was downloaded from - so the queries live here and each
 * caller only decides how many rows it wants and how to render them.
 *
 * Rows carry raw values, not formatted strings: the page formats them for
 * reading, and the spreadsheet writes real numbers and dates so the recipient
 * can sort, total and pivot without cleaning the file up first.
 */

export type DrillKind = "collections" | "receivables" | "revenue";

/**
 * `currency` is the three-letter code a document was raised in, and
 * `money_ccy` is an amount denominated in it. The pair travels together: the
 * renderer formats a money_ccy cell using the currency cell on its own row, so
 * a dollar figure groups in threes beside a rupee one grouped in lakhs.
 */
export type CellType =
  | "text"
  | "date"
  | "money"
  | "days"
  | "percent"
  | "currency"
  | "money_ccy";

export interface DrillColumn {
  header: string;
  type: CellType;
  /** the column the reader came for */
  strong?: boolean;
}

export type DrillCell = string | number | null;

export interface DrillResult {
  title: string;
  columns: DrillColumn[];
  rows: DrillCell[][];
  /** how many rows exist in total, which may exceed those returned */
  total: number;
}

export interface DrillRequest {
  kind: DrillKind;
  drill: string;
  entity: Entity;
  start: string;
  end: string;
  verticalId: number | null;
  /** one customer's side of the page, when a customer has been picked */
  customer?: string | null;
  /** narrow to documents raised in one currency, e.g. "USD" */
  currency?: string | null;
  /** omit for everything - the export wants the lot, the screen does not */
  limit?: number;
}

/** Labels for each drill, so the panel heading and the sheet name agree. */
const TITLES: Record<DrillKind, Record<string, string>> = {
  collections: {
    total: "All receipts",
    fee: "Fee receipts",
    ri: "Reimbursement recoveries",
    unmatched: "Receipts not traced to an invoice",
    customer: "Receipts from one customer",
  },
  receivables: {
    total: "Every open invoice",
    current: "Not yet due",
    over90: "Overdue more than 90 days",
    over180: "Overdue more than 180 days",
    over365: "Overdue more than 1 year",
    top10: "Top 10 customers by balance",
    customer: "Outstanding invoices for one customer",
  },
  revenue: {
    all: "All invoices",
    fee: "Fee invoices",
    retainers: "Recurring retainership fee by customer",
    customer: "Invoices raised on one customer",
    ri: "Reimbursement invoices",
    credit_notes: "Credit notes",
    excluded: "Void, rejected and draft invoices",
  },
};

export function drillTitle(kind: DrillKind, drill: string): string | null {
  return TITLES[kind]?.[drill] ?? null;
}

export function isDrill(kind: DrillKind, drill: string | null): drill is string {
  return !!drill && !!TITLES[kind]?.[drill];
}

const EXCLUDED_STATUS = ["void", "rejected", "draft"];

/**
 * A receipt that cannot be tied back to an invoice.
 *
 * Either it carries no invoice reference in Zoho at all (`basis = 'unmatched'`),
 * or the invoice it names is in no uploaded register, so no vertical came back
 * with it. Both belong in the same list, and the page notice and the drill-down
 * below it must ask the same question - they briefly asked two, and the notice
 * then counted six receipts above a table showing seven.
 */
export const UNTRACEABLE_RECEIPT = "(a.vertical_id is null or a.basis = 'unmatched')";

/** Age is measured from the due date, falling back to the invoice date. */
const ageExpr = (t = "") => `(${t}as_of - coalesce(${t}due_date, ${t}invoice_date))`;

/**
 * The ageing bands, in one place.
 *
 * The page draws them, the vertical table columns them and the top-10 drill
 * ages customers by them. Three copies of "between 181 and 365" is three
 * chances for one of them to say 360, and the reader would have no way to tell
 * which column was lying.
 */
export const AR_BUCKETS = [
  { key: "current", label: "Not yet due", test: (t = "") => `${ageExpr(t)} <= 0` },
  { key: "d30", label: "1 - 30 days", test: (t = "") => `${ageExpr(t)} between 1 and 30` },
  { key: "d90", label: "31 - 90 days", test: (t = "") => `${ageExpr(t)} between 31 and 90` },
  { key: "d180", label: "91 - 180 days", test: (t = "") => `${ageExpr(t)} between 91 and 180` },
  { key: "d365", label: "181 days - 1 year", test: (t = "") => `${ageExpr(t)} between 181 and 365` },
  { key: "y1", label: "Over 1 year", test: (t = "") => `${ageExpr(t)} > 365` },
] as const;

export type ArBucketKey = (typeof AR_BUCKETS)[number]["key"];

/** The bucket columns of an aggregate query, aliased by key. */
export function arBucketSelect(t = "", amount = "balance_base"): string {
  return AR_BUCKETS.map(
    (b) => `coalesce(sum(case when ${b.test(t)} then ${t}${amount} else 0 end),0)::numeric as ${b.key}`,
  ).join(",\n            ");
}

/**
 * What an open item is worth in the currency it was actually billed in.
 *
 * Zoho's Indian-base exports carry every amount already converted to INR, and
 * exchange_rate is there to get *back* to the billing currency - so the
 * original figure is balance ÷ rate. An INR invoice divides by 1 and is
 * unchanged, which is why one expression serves both and no currency test is
 * needed. Multiplying instead is the classic mistake and inflates a USD
 * balance by roughly eighty times.
 */
export function arOriginalAmount(t = "", amount = "balance_base"): string {
  return `(${t}${amount} / nullif(${t}exchange_rate, 0))`;
}

/** How many invoices sit in each ageing band, aliased `<key>_n`. */
export function arBucketCounts(t = ""): string {
  return AR_BUCKETS.map(
    (b) => `count(*) filter (where ${b.test(t)})::int as ${b.key}_n`,
  ).join(",\n            ");
}

export async function runDrill(req: DrillRequest): Promise<DrillResult | null> {
  const title = drillTitle(req.kind, req.drill);
  if (!title) return null;

  const cap = req.limit ? `limit ${Math.max(1, Math.floor(req.limit))}` : "";
  const company: DrillColumn[] = req.entity.isGroup ? [{ header: "Company", type: "text" }] : [];
  const pickCompany = <T extends { company: string }>(r: T): DrillCell[] =>
    req.entity.isGroup ? [r.company] : [];

  if (req.kind === "collections") {
    /**
     * Read from payment_allocations, not payments: a remittance settling a fee
     * invoice and an RI invoice belongs partly in each tile, so it appears in
     * both at its split value. Its full value in both would double whatever
     * total the reader is drilling into.
     */
    const where: Record<string, string> = {
      total: "true",
      fee: "not a.is_reimbursement",
      ri: "a.is_reimbursement",
      unmatched: UNTRACEABLE_RECEIPT,
      // Every receipt from the picked customer; the customer clause below is
      // what narrows it.
      customer: "true",
    };
    const scope = `a.entity_id = any($1::int[]) and p.payment_date between $2 and $3
                   and ($4::int is null or a.vertical_id = $4)
                   ${verticalScope("$5", "a.vertical_id")}
                   and ($6::text is null or p.customer_name = $6)
                   and ($7::text is null or upper(coalesce(p.currency, 'INR')) = $7)
                   and ${where[req.drill]}`;
    const args = [
      req.entity.memberIds, req.start, req.end, req.verticalId, req.entity.verticalIds,
      req.customer ?? null,
      req.currency ? req.currency.toUpperCase() : null,
    ];

    const [rows, count] = await Promise.all([
      query<{
        payment_date: string; payment_number: string | null; company: string;
        customer_name: string; invoices: string | null;
        currency: string; amount_billed: number | null;
        amount: number; unallocated: number;
      }>(
        `select p.payment_date::text, p.payment_number, e.name as company, p.customer_name,
                string_agg(distinct a.invoice_number, ', ') as invoices,
                upper(coalesce(p.currency, 'INR')) as currency,
                -- A receipt split across two invoices belongs to each in
                -- proportion, so its own-currency figure is split the same way
                -- rather than repeated whole in both rows.
                case when upper(coalesce(p.currency, 'INR')) = 'INR'
                       or max(p.amount_foreign) is null
                       or max(p.amount_base) = 0 then null
                     else sum(a.amount_base) * max(p.amount_foreign) / max(p.amount_base)
                end::numeric as amount_billed,
                sum(a.amount_base)::numeric as amount,
                max(p.unallocated_base)::numeric as unallocated
           from payment_allocations a
           join payments p on p.id = a.payment_id
           join entities e on e.id = p.entity_id
          where ${scope}
          group by p.id, p.payment_date, p.payment_number, e.name, p.customer_name, p.currency
          order by p.payment_date, sum(a.amount_base) desc
          ${cap}`,
        args,
      ),
      queryOne<{ n: number }>(
        `select count(distinct p.id)::int n
           from payment_allocations a join payments p on p.id = a.payment_id
          where ${scope}`,
        args,
      ),
    ]);

    return {
      title,
      columns: [
        { header: "Date", type: "date" },
        { header: "Receipt", type: "text" },
        ...company,
        { header: "Customer", type: "text" },
        { header: "Invoices mapped", type: "text" },
        { header: "Received in", type: "currency" },
        { header: "Amount received", type: "money_ccy" },
        { header: "Amount (INR)", type: "money", strong: true },
        { header: "Unallocated (INR)", type: "money" },
      ],
      rows: rows.map((r) => [
        r.payment_date,
        r.payment_number,
        ...pickCompany(r),
        r.customer_name,
        r.invoices,
        r.currency,
        r.amount_billed === null ? null : Number(r.amount_billed),
        Number(r.amount),
        Number(r.unallocated) || null,
      ]),
      total: Number(count?.n ?? 0),
    };
  }

  if (req.kind === "receivables" && req.drill === "top10") {
    /**
     * Who the balance is actually with.
     *
     * Ranked by what is owed, aged across the same bands as everything else,
     * and carrying each customer share of the whole book - concentration is
     * the point of the list, and a share column is the only way to see that
     * two names are half the ledger without doing arithmetic in your head.
     *
     * The share is of the *whole* book, not of the ten, so the column sums to
     * the concentration figure on the tile rather than to 100%.
     */
    const scope = `(a.entity_id, a.as_of) in (
                     select entity_id, max(as_of) from ar_open_items
                      where entity_id = any($1::int[]) group by entity_id)
                   and ($2::int is null or a.vertical_id = $2)
                   ${verticalScope("$3", "a.vertical_id")}`;
    const args = [req.entity.memberIds, req.verticalId, req.entity.verticalIds];

    const [rows, book] = await Promise.all([
      query<Record<string, string | number>>(
        `select a.customer_name, ${arBucketSelect("a.")},
                coalesce(sum(a.balance_base),0)::numeric as total,
                count(*)::int as invoices
           from ar_open_items a
          where ${scope}
          group by a.customer_name
          order by total desc
          limit 10`,
        args,
      ),
      queryOne<{ v: number }>(
        `select coalesce(sum(a.balance_base),0)::numeric v from ar_open_items a where ${scope}`,
        args,
      ),
    ]);

    const total = Number(book?.v ?? 0);
    return {
      title,
      columns: [
        { header: "Customer", type: "text" },
        { header: "Open invoices", type: "text" },
        ...AR_BUCKETS.map((b) => ({ header: b.label, type: "money" as const })),
        { header: "Total", type: "money" as const, strong: true },
        { header: "% of book", type: "percent" as const },
      ],
      rows: rows.map((r) => [
        String(r.customer_name),
        Number(r.invoices),
        // An empty band is left blank rather than printed as a zero: an ageing
        // matrix is mostly empty, and a grid of noughts hides the few cells
        // that carry anything.
        ...AR_BUCKETS.map((b) => Number(r[b.key]) || null),
        Number(r.total),
        total > 0 ? Math.round((Number(r.total) / total) * 10000) / 100 : null,
      ]),
      // The list is the top ten by definition - there is no larger set being
      // capped, so the count shown is the count returned.
      total: rows.length,
    };
  }

  if (req.kind === "receivables") {
    // Receivables are a snapshot, not a period: each company at its own most
    // recent AR export, which need not be the same day as the other's.
    const test: Record<string, (t?: string) => string> = {
      total: () => "true",
      current: (t) => `${ageExpr(t)} <= 0`,
      over90: (t) => `${ageExpr(t)} > 90`,
      over180: (t) => `${ageExpr(t)} > 180`,
      over365: (t) => `${ageExpr(t)} > 365`,
      // Everything still open for the picked customer; the customer clause
      // below is what narrows it.
      customer: () => "true",
    };
    const scope = `(a.entity_id, a.as_of) in (
                     select entity_id, max(as_of) from ar_open_items
                      where entity_id = any($1::int[]) group by entity_id)
                   and ($2::int is null or a.vertical_id = $2)
                   ${verticalScope("$3", "a.vertical_id")}
                   and ($4::text is null or a.customer_name = $4)
                   and ($5::text is null or upper(coalesce(a.currency, 'INR')) = $5)
                   and ${test[req.drill]("a.")}`;
    const args = [
      req.entity.memberIds, req.verticalId, req.entity.verticalIds, req.customer ?? null,
      req.currency ? req.currency.toUpperCase() : null,
    ];

    const [rows, count] = await Promise.all([
      query<{
        invoice_number: string | null; invoice_date: string | null; due_date: string | null;
        company: string; customer_name: string; salesperson: string | null;
        age: number; invoice_amount: number; balance_base: number;
        currency: string; billed_invoice: number | null; billed_balance: number | null;
      }>(
        `select a.invoice_number, a.invoice_date::text, a.due_date::text, e.name as company,
                a.customer_name, a.salesperson, ${ageExpr("a.")}::int as age,
                upper(coalesce(a.currency, 'INR')) as currency,
                case when upper(coalesce(a.currency, 'INR')) = 'INR' then null
                     else ${arOriginalAmount("a.", "invoice_amount")} end as billed_invoice,
                case when upper(coalesce(a.currency, 'INR')) = 'INR' then null
                     else ${arOriginalAmount("a.")} end as billed_balance,
                a.invoice_amount, a.balance_base
           from ar_open_items a join entities e on e.id = a.entity_id
          where ${scope}
          order by ${req.drill === "customer" ? "a.invoice_date, a.balance_base desc" : "a.balance_base desc"}
          ${cap}`,
        args,
      ),
      queryOne<{ n: number }>(
        `select count(*)::int n from ar_open_items a where ${scope}`,
        args,
      ),
    ]);

    return {
      title,
      columns: [
        { header: "Invoice", type: "text" },
        { header: "Date", type: "date" },
        { header: "Due", type: "date" },
        ...company,
        { header: "Customer", type: "text" },
        { header: "Salesperson", type: "text" },
        { header: "Age", type: "days" },
        { header: "Raised in", type: "currency" },
        { header: "Invoice value billed", type: "money_ccy" },
        { header: "Balance billed", type: "money_ccy" },
        { header: "Invoice value (INR)", type: "money" },
        { header: "Balance (INR)", type: "money", strong: true },
      ],
      rows: rows.map((r) => [
        r.invoice_number,
        r.invoice_date,
        r.due_date,
        ...pickCompany(r),
        r.customer_name,
        r.salesperson,
        Number(r.age),
        r.currency,
        r.billed_invoice === null ? null : Number(r.billed_invoice),
        r.billed_balance === null ? null : Number(r.billed_balance),
        Number(r.invoice_amount),
        Number(r.balance_base),
      ]),
      total: Number(count?.n ?? 0),
    };
  }

  if (req.kind === "revenue" && req.drill === "retainers") {
    /**
     * Which clients are on a retainer, month by month.
     *
     * The headline carries retainership as one number, which is the right
     * altitude for a tile and useless for the question actually asked of it:
     * a customer whose retainer runs April to June and then stops is invisible
     * in a total and obvious in a row.
     *
     * Read straight from what was loaded - the retainer file is a list of
     * customer, month and amount, so this is that list pivoted rather than a
     * derivation of it. The months shown are the months the window covers that
     * anything was actually billed in, so a table of empty columns never
     * pushes the ones carrying figures off the side of the page.
     */
    const scope = `r.entity_id = any($1::int[]) and r.month between $2 and $3
                   and ($4::int is null or r.vertical_id = $4)
                   ${verticalScope("$5", "r.vertical_id")}`;
    const args = [req.entity.memberIds, req.start, req.end, req.verticalId, req.entity.verticalIds];

    const rows = await query<{
      customer_name: string; vertical: string | null; month_key: string; amount: number;
    }>(
      `select r.customer_name, v.name as vertical,
              to_char(r.month, 'YYYY-MM') as month_key,
              sum(r.amount_base)::numeric as amount
         from retainer_revenue r
         left join verticals v on v.id = r.vertical_id
        where ${scope}
        group by r.customer_name, v.name, to_char(r.month, 'YYYY-MM')`,
      args,
    );

    const monthKeys = [...new Set(rows.map((r) => r.month_key))].sort();
    // One customer can sit under two verticals across the two companies, so
    // the row is keyed on the pair rather than folding one into the other.
    const byCustomer = new Map<string, { customer: string; vertical: string | null; months: Map<string, number>; total: number }>();
    for (const r of rows) {
      const key = `${r.customer_name}|${r.vertical ?? ""}`;
      const found =
        byCustomer.get(key) ??
        { customer: r.customer_name, vertical: r.vertical, months: new Map<string, number>(), total: 0 };
      const amount = Number(r.amount);
      found.months.set(r.month_key, (found.months.get(r.month_key) ?? 0) + amount);
      found.total += amount;
      byCustomer.set(key, found);
    }

    const monthLabels = monthKeys.map((k) => {
      const [y, m] = k.split("-");
      const abbr = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      return `${abbr[Number(m) - 1]} ${y.slice(2)}`;
    });

    // Largest retainer first: the table is read from the top and stopped at.
    const ordered = [...byCustomer.values()].sort((a, b) => b.total - a.total);
    const capped = req.limit ? ordered.slice(0, Math.max(1, Math.floor(req.limit))) : ordered;

    return {
      title,
      columns: [
        { header: "Customer", type: "text" },
        ...(req.verticalId === null ? [{ header: "Vertical", type: "text" as const }] : []),
        ...monthLabels.map((label) => ({ header: label, type: "money" as const })),
        { header: "Total", type: "money" as const, strong: true },
      ],
      rows: capped.map((c) => [
        c.customer,
        ...(req.verticalId === null ? [c.vertical] : []),
        // A blank month is one the customer was not billed a retainer in, which
        // is the signal worth seeing - a zero would read as a billed nil.
        ...monthKeys.map((k) => c.months.get(k) ?? null),
        c.total,
      ]),
      total: ordered.length,
    };
  }

  // Revenue. Invoices and credit notes are separate tables with the same shape
  // on screen, so the column names differ but the query does not.
  const isCn = req.drill === "credit_notes";
  const from = isCn ? "credit_notes i" : "invoice_lines i";
  const numberCol = isCn ? "i.credit_note_number" : "i.invoice_number";
  const dateCol = isCn ? "i.credit_note_date" : "i.invoice_date";
  const amountCol = isCn ? "i.cn_amount_base" : "i.amount_base";
  const totalCol = isCn ? "i.cn_total_base" : "i.total_base";
  const personCol = isCn ? "null::text" : "i.salesperson";
  const kindWhere: Record<string, string> = {
    // Fee and reimbursement together - exactly what the currency card counted,
    // so clicking a currency lands on the invoices behind that row.
    all: "true",
    fee: "not i.is_reimbursement",
    ri: "i.is_reimbursement",
    credit_notes: "i.is_primary_row",
    excluded: "true",
    // Fee and reimbursement together: a customer statement that quietly left
    // out the recharges would not agree with what they were actually billed.
    customer: "true",
  };
  // "Excluded" is the one tile that wants exactly what every other figure drops.
  const statusFilter =
    req.drill === "excluded" ? "i.status = any($5)" : "not (i.status = any($5))";
  const scope = `i.entity_id = any($1::int[]) and ${dateCol} between $2 and $3
                 and ($4::int is null or i.vertical_id = $4)
                 ${verticalScope("$6", "i.vertical_id")}
                 and ($7::text is null or i.customer_name = $7)
                 and ($8::text is null or upper(coalesce(i.currency, 'INR')) = $8)
                 and ${statusFilter} and ${kindWhere[req.drill]}`;
  const args = [
    req.entity.memberIds, req.start, req.end, req.verticalId, EXCLUDED_STATUS,
    req.entity.verticalIds, req.customer ?? null,
    req.currency ? req.currency.toUpperCase() : null,
  ];

  const [rows, count] = await Promise.all([
    query<{
      number: string | null; doc_date: string; company: string; customer_name: string;
      salesperson: string | null; status: string | null;
      currency: string; amount_billed: number | null;
      amount_base: number; total_base: number;
    }>(
      `select ${numberCol} as number, ${dateCol}::text as doc_date, e.name as company,
              i.customer_name, ${personCol} as salesperson, i.status,
              upper(coalesce(i.currency, 'INR')) as currency,
              -- Zoho carries the INR conversion and leaves exchange_rate to get
              -- back, so the billed figure is amount ÷ rate. Null on a rupee
              -- invoice, where it would only repeat the column beside it.
              case when upper(coalesce(i.currency, 'INR')) = 'INR' then null
                   else ${amountCol} / nullif(i.exchange_rate, 0) end as amount_billed,
              ${amountCol} as amount_base, ${totalCol} as total_base
         from ${from}
         join entities e on e.id = i.entity_id
        where ${scope}
        order by ${dateCol}, ${amountCol} desc
        ${cap}`,
      args,
    ),
    queryOne<{ n: number }>(`select count(*)::int n from ${from} where ${scope}`, args),
  ]);

  return {
    title,
    columns: [
      { header: isCn ? "Credit note" : "Invoice", type: "text" },
      { header: "Date", type: "date" },
      ...company,
      { header: "Customer", type: "text" },
      { header: "Salesperson", type: "text" },
      { header: "Status", type: "text" },
      { header: "Raised in", type: "currency" },
      { header: "Amount billed", type: "money_ccy" },
      { header: "Amount (INR)", type: "money", strong: true },
      { header: "Incl. tax (INR)", type: "money" },
    ],
    rows: rows.map((r) => [
      r.number,
      r.doc_date,
      ...pickCompany(r),
      r.customer_name,
      r.salesperson,
      r.status,
      r.currency,
      r.amount_billed === null ? null : Number(r.amount_billed),
      Number(r.amount_base),
      Number(r.total_base),
    ]),
    total: Number(count?.n ?? 0),
  };
}

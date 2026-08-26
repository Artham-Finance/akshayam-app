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

export type CellType = "text" | "date" | "money" | "days";

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
  },
  receivables: {
    total: "Every open invoice",
    current: "Not yet due",
    over90: "Overdue more than 90 days",
    over180: "Overdue more than 180 days",
  },
  revenue: {
    fee: "Fee invoices",
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
    };
    const scope = `a.entity_id = any($1::int[]) and p.payment_date between $2 and $3
                   and ($4::int is null or a.vertical_id = $4)
                   ${verticalScope("$5", "a.vertical_id")}
                   and ${where[req.drill]}`;
    const args = [req.entity.memberIds, req.start, req.end, req.verticalId, req.entity.verticalIds];

    const [rows, count] = await Promise.all([
      query<{
        payment_date: string; payment_number: string | null; company: string;
        customer_name: string; mode: string | null; invoices: string | null;
        amount: number; unallocated: number;
      }>(
        `select p.payment_date::text, p.payment_number, e.name as company, p.customer_name,
                p.mode,
                string_agg(distinct a.invoice_number, ', ') as invoices,
                sum(a.amount_base)::numeric as amount,
                max(p.unallocated_base)::numeric as unallocated
           from payment_allocations a
           join payments p on p.id = a.payment_id
           join entities e on e.id = p.entity_id
          where ${scope}
          group by p.id, p.payment_date, p.payment_number, e.name, p.customer_name, p.mode
          order by p.payment_date desc, sum(a.amount_base) desc
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
        { header: "Mode", type: "text" },
        { header: "Invoices mapped", type: "text" },
        { header: "Amount", type: "money", strong: true },
        { header: "Unallocated", type: "money" },
      ],
      rows: rows.map((r) => [
        r.payment_date,
        r.payment_number,
        ...pickCompany(r),
        r.customer_name,
        r.mode,
        r.invoices,
        Number(r.amount),
        Number(r.unallocated) || null,
      ]),
      total: Number(count?.n ?? 0),
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
    };
    const scope = `(a.entity_id, a.as_of) in (
                     select entity_id, max(as_of) from ar_open_items
                      where entity_id = any($1::int[]) group by entity_id)
                   and ($2::int is null or a.vertical_id = $2)
                   ${verticalScope("$3", "a.vertical_id")}
                   and ${test[req.drill]("a.")}`;
    const args = [req.entity.memberIds, req.verticalId, req.entity.verticalIds];

    const [rows, count] = await Promise.all([
      query<{
        invoice_number: string | null; invoice_date: string | null; due_date: string | null;
        company: string; customer_name: string; salesperson: string | null;
        age: number; invoice_amount: number; balance_base: number;
      }>(
        `select a.invoice_number, a.invoice_date::text, a.due_date::text, e.name as company,
                a.customer_name, a.salesperson, ${ageExpr("a.")}::int as age,
                a.invoice_amount, a.balance_base
           from ar_open_items a join entities e on e.id = a.entity_id
          where ${scope}
          order by a.balance_base desc
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
        { header: "Invoice value", type: "money" },
        { header: "Balance", type: "money", strong: true },
      ],
      rows: rows.map((r) => [
        r.invoice_number,
        r.invoice_date,
        r.due_date,
        ...pickCompany(r),
        r.customer_name,
        r.salesperson,
        Number(r.age),
        Number(r.invoice_amount),
        Number(r.balance_base),
      ]),
      total: Number(count?.n ?? 0),
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
    fee: "not i.is_reimbursement",
    ri: "i.is_reimbursement",
    credit_notes: "i.is_primary_row",
    excluded: "true",
  };
  // "Excluded" is the one tile that wants exactly what every other figure drops.
  const statusFilter =
    req.drill === "excluded" ? "i.status = any($5)" : "not (i.status = any($5))";
  const scope = `i.entity_id = any($1::int[]) and ${dateCol} between $2 and $3
                 and ($4::int is null or i.vertical_id = $4)
                 ${verticalScope("$6", "i.vertical_id")}
                 and ${statusFilter} and ${kindWhere[req.drill]}`;
  const args = [
    req.entity.memberIds, req.start, req.end, req.verticalId, EXCLUDED_STATUS,
    req.entity.verticalIds,
  ];

  const [rows, count] = await Promise.all([
    query<{
      number: string | null; doc_date: string; company: string; customer_name: string;
      salesperson: string | null; status: string | null;
      amount_base: number; total_base: number;
    }>(
      `select ${numberCol} as number, ${dateCol}::text as doc_date, e.name as company,
              i.customer_name, ${personCol} as salesperson, i.status,
              ${amountCol} as amount_base, ${totalCol} as total_base
         from ${from}
         join entities e on e.id = i.entity_id
        where ${scope}
        order by ${dateCol} desc, ${amountCol} desc
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
      { header: "Amount", type: "money", strong: true },
      { header: "Incl. tax", type: "money" },
    ],
    rows: rows.map((r) => [
      r.number,
      r.doc_date,
      ...pickCompany(r),
      r.customer_name,
      r.salesperson,
      r.status,
      Number(r.amount_base),
      Number(r.total_base),
    ]),
    total: Number(count?.n ?? 0),
  };
}

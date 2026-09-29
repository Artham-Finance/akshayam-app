import { query } from "@/lib/db";
import { getAvailableFinancialYears, type Entity } from "@/lib/entity";
import { fyStartYearOf } from "@/lib/period";

/**
 * Customer-wise revenue, year on year.
 *
 * Two sources, picked per year, not one. A year the general ledger actually
 * covers reads invoice_lines - the same ledger-derived figure every other
 * revenue view in the app is struck on, so the current year here agrees with
 * the Revenue tab exactly. A year the ledger was never uploaded for at all
 * (a firm does not re-upload its 2022-23 ledger for a trend table) falls
 * back to the invoice register instead - a raw export, not vetted the way
 * the ledger is, but the only thing that exists for that year. Which years
 * count as "the ledger covers it" is decided once, from the same query the
 * financial-year picker uses, not per row - a year is either backed by the
 * ledger or it is not.
 *
 * A reimbursement recharge (an "RI-" numbered invoice, or invoice_lines' own
 * is_reimbursement flag) is not fee income and is left out, matching how
 * Revenue is defined everywhere else in the app. In the register-sourced
 * years, void, rejected and draft invoices are left out too - a draft never
 * happened and a void or rejected one did not either; invoice_lines needs no
 * equivalent filter, since a row only exists there when the ledger actually
 * posted it.
 */

export interface CustomerTrendYear {
  fy: number;
  label: string;
  isCurrent: boolean;
}

export interface CustomerTrendRow {
  customer: string;
  byYear: Record<number, number>;
  total: number;
}

export interface NewCustomerRow {
  customer: string;
  /** the current year's revenue - the only year this customer has any */
  amount: number;
}

export interface CustomerRevenueTrend {
  years: CustomerTrendYear[];
  rows: CustomerTrendRow[];
  totalByYear: Record<number, number>;
  grandTotal: number;
  /** billed for the first time this year - no revenue in any earlier year on the table */
  newCustomers: NewCustomerRow[];
  newCustomersTotal: number;
}

const EXCLUDED_STATUS = ["void", "rejected", "draft"];

const fyShortLabel = (fy: number) => `${fy}-${String(fy + 1).slice(2)}`;

export async function buildCustomerRevenueTrend(entity: Entity): Promise<CustomerRevenueTrend> {
  const glYears = new Set(await getAvailableFinancialYears(entity.memberIds));

  const [registerRows, ledgerRows] = await Promise.all([
    query<{ customer_name: string; fy: number; amount: number }>(
      `select customer_name,
              case when extract(month from invoice_date) >= 4
                   then extract(year from invoice_date)
                   else extract(year from invoice_date) - 1 end::int as fy,
              sum(amount_base)::numeric as amount
         from invoice_register
        where entity_id = any($1::int[])
          and not (coalesce(status, '') = any($2))
          and invoice_number not ilike 'RI-%'
        group by customer_name, fy`,
      [entity.memberIds, EXCLUDED_STATUS],
    ),
    query<{ customer_name: string; fy: number; amount: number }>(
      `select customer_name,
              case when extract(month from invoice_date) >= 4
                   then extract(year from invoice_date)
                   else extract(year from invoice_date) - 1 end::int as fy,
              sum(amount_base)::numeric as amount
         from invoice_lines
        where entity_id = any($1::int[]) and not is_reimbursement
        group by customer_name, fy`,
      [entity.memberIds],
    ),
  ]);

  // The ledger wins for any year it actually covers; the register only fills
  // in the years it does not.
  const rows = [
    ...registerRows.filter((r) => !glYears.has(r.fy)),
    ...ledgerRows.filter((r) => glYears.has(r.fy)),
  ];

  const currentFy = fyStartYearOf(new Date(), entity.fy_start_month);
  const fySet = new Set(rows.map((r) => r.fy));
  fySet.add(currentFy);
  const years: CustomerTrendYear[] = [...fySet]
    .sort((a, b) => a - b)
    .map((fy) => ({ fy, label: fyShortLabel(fy), isCurrent: fy === currentFy }));

  const byCustomer = new Map<string, CustomerTrendRow>();
  for (const r of rows) {
    const amount = Number(r.amount);
    if (amount === 0) continue;
    const draft = byCustomer.get(r.customer_name) ?? {
      customer: r.customer_name,
      byYear: {},
      total: 0,
    };
    draft.byYear[r.fy] = (draft.byYear[r.fy] ?? 0) + amount;
    draft.total += amount;
    byCustomer.set(r.customer_name, draft);
  }

  const sortedRows = [...byCustomer.values()].sort((a, b) => b.total - a.total);

  const totalByYear: Record<number, number> = {};
  for (const y of years) {
    totalByYear[y.fy] = sortedRows.reduce((s, r) => s + (r.byYear[y.fy] ?? 0), 0);
  }
  const grandTotal = sortedRows.reduce((s, r) => s + r.total, 0);

  // First billed this year: no positive revenue in any earlier year the
  // table carries. A customer new to a prior year already reads as one
  // there; this list is only ever struck against the current year.
  const currentYear = years.find((y) => y.isCurrent);
  const priorYears = years.filter((y) => !y.isCurrent);
  const newCustomers: NewCustomerRow[] = currentYear
    ? sortedRows
        .filter(
          (r) =>
            (r.byYear[currentYear.fy] ?? 0) > 0 &&
            priorYears.every((y) => !((r.byYear[y.fy] ?? 0) > 0)),
        )
        .map((r) => ({ customer: r.customer, amount: r.byYear[currentYear.fy] }))
        .sort((a, b) => b.amount - a.amount)
    : [];
  const newCustomersTotal = newCustomers.reduce((s, r) => s + r.amount, 0);

  return { years, rows: sortedRows, totalByYear, grandTotal, newCustomers, newCustomersTotal };
}

export interface CustomerInvoiceRow {
  invoiceNumber: string;
  invoiceDate: string;
  fy: number;
  amount: number;
  status: string | null;
  /** which table this row was read from, since the two years use different sources */
  source: "ledger" | "register";
}

/**
 * Every invoice behind the year-on-year rows above, for a batch of
 * customers at once - one pair of queries rather than one per customer, so
 * expanding a row on screen is free: the detail is already in hand, not a
 * fetch away. The same two sources, split by the same rule: a year the
 * ledger covers reads invoice_lines, one it does not reads the register.
 * Grouped back to one row per invoice number on the ledger side, since a
 * single invoice split across verticals would otherwise repeat under the
 * same number at a different amount, which reads as a mistake rather than
 * what it is.
 */
export async function buildCustomerInvoiceDetailBatch(
  entity: Entity,
  customers: string[],
): Promise<Map<string, CustomerInvoiceRow[]>> {
  const byCustomer = new Map<string, CustomerInvoiceRow[]>();
  if (customers.length === 0) return byCustomer;

  const glYears = new Set(await getAvailableFinancialYears(entity.memberIds));

  const [registerRows, ledgerRows] = await Promise.all([
    query<{
      customer_name: string; invoice_number: string; invoice_date: string;
      amount: number; status: string | null;
    }>(
      `select customer_name, invoice_number, invoice_date::text,
              sum(amount_base)::numeric as amount, max(status) as status
         from invoice_register
        where entity_id = any($1::int[]) and customer_name = any($2::text[])
          and not (coalesce(status, '') = any($3))
          and invoice_number not ilike 'RI-%'
        group by customer_name, invoice_number, invoice_date
        order by invoice_date`,
      [entity.memberIds, customers, EXCLUDED_STATUS],
    ),
    query<{
      customer_name: string; invoice_number: string; invoice_date: string;
      amount: number; status: string | null;
    }>(
      `select customer_name, invoice_number, invoice_date::text,
              sum(amount_base)::numeric as amount, max(status) as status
         from invoice_lines
        where entity_id = any($1::int[]) and customer_name = any($2::text[]) and not is_reimbursement
        group by customer_name, invoice_number, invoice_date
        order by invoice_date`,
      [entity.memberIds, customers],
    ),
  ]);

  const fyOf = (isoDate: string): number => {
    const [y, m] = isoDate.split("-").map(Number);
    return m >= 4 ? y : y - 1;
  };

  const add = (
    r: { customer_name: string; invoice_number: string; invoice_date: string; amount: number; status: string | null },
    source: "ledger" | "register",
  ) => {
    const fy = fyOf(r.invoice_date);
    if (source === "register" ? glYears.has(fy) : !glYears.has(fy)) return;
    const amount = Number(r.amount);
    if (amount === 0) return;
    const list = byCustomer.get(r.customer_name) ?? [];
    list.push({
      invoiceNumber: r.invoice_number,
      invoiceDate: r.invoice_date,
      fy,
      amount,
      status: r.status,
      source,
    });
    byCustomer.set(r.customer_name, list);
  };

  for (const r of registerRows) add(r, "register");
  for (const r of ledgerRows) add(r, "ledger");

  for (const list of byCustomer.values()) {
    list.sort((a, b) => (a.invoiceDate < b.invoiceDate ? -1 : a.invoiceDate > b.invoiceDate ? 1 : 0));
  }

  return byCustomer;
}

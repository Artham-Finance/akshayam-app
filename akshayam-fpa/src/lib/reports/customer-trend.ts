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

export interface CustomerRevenueTrend {
  years: CustomerTrendYear[];
  rows: CustomerTrendRow[];
  totalByYear: Record<number, number>;
  grandTotal: number;
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

  return { years, rows: sortedRows, totalByYear, grandTotal };
}

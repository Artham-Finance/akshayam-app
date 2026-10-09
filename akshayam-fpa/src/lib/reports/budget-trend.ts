import { query } from "@/lib/db";
import { verticalScope, type Entity } from "@/lib/entity";
import { fyBounds, fyMonths, groupByQuarter, monthsElapsed, type QuarterNo } from "@/lib/period";
import type { Measure } from "@/lib/reports/budget";
import { hasRevisedBudget, revisedBudgetForVertical } from "@/lib/reports/scorecard-budget";

/**
 * Budget against actual, laid out as a year's schedule: year to date,
 * quarter to date, and the four quarters each broken into their own three
 * months. Used for both revenue and collections - same shape, different
 * actuals source.
 *
 * The annual budget is spread evenly across the twelve months - the same
 * whole-months convention the rest of the app uses for a period's share of
 * the year, just carried all the way down to every individual month rather
 * than struck once for a single window. A month past the year to date still
 * gets a row: its budget is real even though nothing has been posted
 * against it yet, and a schedule that stopped at today would not read as
 * the year's plan.
 */

export interface TrendCells {
  budget: number;
  actual: number;
  variance: number;
  /** actual as a percentage of budget; null when there is no budget to measure against */
  achievement: number | null;
}

export interface TrendMonthRow {
  key: string;
  label: string;
  cells: TrendCells;
}

export interface TrendQuarterGroup {
  quarter: QuarterNo;
  label: string;
  cells: TrendCells;
  months: TrendMonthRow[];
}

export interface BudgetTrend {
  fyStartYear: number;
  ytd: TrendCells;
  qtd: {
    label: string;
    cells: TrendCells;
    /** the elapsed months of the current quarter that make it up - empty before any have closed */
    months: TrendMonthRow[];
  };
  quarters: TrendQuarterGroup[];
}

const cellsOf = (budget: number, actual: number): TrendCells => ({
  budget,
  actual,
  variance: actual - budget,
  achievement: budget !== 0 ? (actual / budget) * 100 : null,
});

const sumCells = (list: TrendCells[]): TrendCells =>
  cellsOf(
    list.reduce((s, c) => s + c.budget, 0),
    list.reduce((s, c) => s + c.actual, 0),
  );

interface MonthActualRow {
  month_key: string;
  actual: number;
}

/**
 * Revenue actual by month, in the three parts the Actual figure is made of: the
 * ledger's Revenue from Operations (net of credit notes - the P&L line), the
 * outside-books billing added to it, and the revenue transferred to RBJV taken
 * off it (negative). Exported so a page can show the parts beside the total and
 * stay equal to the Actual tile and to the P&L month for month.
 */
export async function revenueActualsByMonthParts(
  entityIds: number[],
  verticalIds: number[] | null,
  verticalId: number | null,
  fyStart: string,
  asOf: string,
): Promise<{ gl: MonthActualRow[]; osb: MonthActualRow[]; transferred: MonthActualRow[] }> {
  const args = [entityIds, fyStart, asOf, verticalIds, verticalId];
  const [gl, osb, transferred] = await Promise.all([
    query<MonthActualRow>(
      `select to_char(g.txn_date, 'YYYY-MM') as month_key, sum(g.credit - g.debit)::numeric as actual
         from gl_entries g
         join accounts a on a.id = g.account_id
        where g.entity_id = any($1::int[]) and g.txn_date between $2 and $3
          and a.statement = 'pnl' and a.group_code = 'revenue'
          ${verticalScope("$4", "g.vertical_id")}
          and ($5::int is null or g.vertical_id = $5)
        group by 1`,
      args,
    ),
    query<MonthActualRow>(
      `select to_char(i.invoice_date, 'YYYY-MM') as month_key, sum(i.amount_base)::numeric as actual
         from invoice_lines i
        where i.entity_id = any($1::int[]) and i.is_osb
          and i.invoice_date between $2 and $3
          ${verticalScope("$4", "i.vertical_id")}
          and ($5::int is null or i.vertical_id = $5)
        group by 1`,
      args,
    ),
    query<MonthActualRow>(
      `select to_char(t.invoice_date, 'YYYY-MM') as month_key, -sum(t.amount)::numeric as actual
         from revenue_transfer_entries t
        where t.entity_id = any($1::int[]) and t.entity_id in (select id from entities where slug = 'akshayam') and t.invoice_date between $2 and $3
          ${verticalScope("$4", "t.vertical_id")}
          and ($5::int is null or t.vertical_id = $5)
        group by 1`,
      args,
    ),
  ]);
  return { gl, osb, transferred };
}

/**
 * What a measure actually did, by month - the same sources
 * buildBudgetVsActual reads for the same measure (see budget.ts), just
 * grouped by month instead of struck over one window.
 */
async function actualsByMonth(
  entityIds: number[],
  verticalIds: number[] | null,
  verticalId: number | null,
  measure: Measure,
  fyStart: string,
  /**
   * The upper bound to read actuals to - the same ledger cutoff every other
   * report on the page is struck to, not the financial year's own end.
   * OSB and the revenue transferred to RBJV are hand-maintained lists, not
   * bounded by the ledger's own close, so without this a month already past
   * that cutoff could still show activity dated after it and disagree with
   * the KPI card sitting right above this table.
   */
  asOf: string,
): Promise<MonthActualRow[]> {
  const args = [entityIds, fyStart, asOf, verticalIds, verticalId];

  if (measure === "revenue") {
    const { gl, osb, transferred } = await revenueActualsByMonthParts(
      entityIds,
      verticalIds,
      verticalId,
      fyStart,
      asOf,
    );
    return [...gl, ...osb, ...transferred];
  }

  // Fee receipts only: a reimbursement recovery is not collection
  // performance. Only the revenue transferred to RBJV that has actually
  // been paid counts here - the same "paidOnly" rule buildBudgetVsActual
  // applies, since this is collection, not billing.
  const [collections, transferred] = await Promise.all([
    query<MonthActualRow>(
      `select to_char(p.payment_date, 'YYYY-MM') as month_key,
              sum(case when a.is_reimbursement then 0 else a.amount_base end)::numeric as actual
         from payment_allocations a
         join payments p on p.id = a.payment_id
        where a.entity_id = any($1::int[]) and p.payment_date between $2 and $3
          ${verticalScope("$4", "a.vertical_id")}
          and ($5::int is null or a.vertical_id = $5)
        group by 1`,
      args,
    ),
    query<MonthActualRow>(
      `select to_char(t.invoice_date, 'YYYY-MM') as month_key, -sum(t.amount)::numeric as actual
         from revenue_transfer_entries t
        where t.entity_id = any($1::int[]) and t.entity_id in (select id from entities where slug = 'akshayam') and t.invoice_date between $2 and $3
          and lower(coalesce(t.status, '')) = 'paid'
          ${verticalScope("$4", "t.vertical_id")}
          and ($5::int is null or t.vertical_id = $5)
        group by 1`,
      args,
    ),
  ]);
  return [...collections, ...transferred];
}

export async function buildBudgetTrend(opts: {
  entity: Entity;
  fyStartYear: number;
  measure: Measure;
  /** one vertical to narrow to, from the page's own picker */
  verticalId?: number | null;
  /** how far to call the year "to date" - the same ledger cutoff every other report uses */
  asOf: string;
  /**
   * Budget each month from the revised quarterly budget (30 Sep 2026) rather
   * than a flat twelfth of the annual figure, where one exists for the year.
   * For the Overview only.
   */
  revised?: boolean;
}): Promise<BudgetTrend> {
  const { entity, fyStartYear, measure, verticalId = null, asOf } = opts;
  const useRevised = !!opts.revised && hasRevisedBudget(fyStartYear);
  const ids = entity.memberIds;
  const { start: fyStart } = fyBounds(fyStartYear, entity.fy_start_month);
  const months = fyMonths(fyStartYear, entity.fy_start_month);

  const [budgetRow, actualRows] = await Promise.all([
    query<{ annual: number }>(
      `select coalesce(sum(annual_amount),0)::numeric as annual
         from budgets
        where entity_id = any($1::int[]) and fy_start_year = $2 and measure = $3
          ${verticalScope("$4")}
          and ($5::int is null or vertical_id = $5)`,
      [ids, fyStartYear, measure, entity.verticalIds, verticalId],
    ),
    actualsByMonth(ids, entity.verticalIds, verticalId, measure, fyStart, asOf),
  ]);

  const annual = Number(budgetRow[0]?.annual ?? 0);
  const monthlyBudget = annual / 12;

  // Each month's budget is the sum, over the verticals in scope, of that
  // vertical's revised quarter spread over the month's days.
  let monthBudgetOf: (m: { start: string; end: string }) => number = () => monthlyBudget;
  if (useRevised) {
    const scoped = await query<{ code: string; slug: string }>(
      `select v.code, e.slug
         from verticals v join entities e on e.id = v.entity_id
        where v.entity_id = any($1::int[])
          and ($2::int[] is null or v.id = any($2::int[]))
          and ($3::int is null or v.id = $3)`,
      [ids, entity.verticalIds, verticalId],
    );
    monthBudgetOf = (m) =>
      scoped.reduce((sum, v) => {
        const b = revisedBudgetForVertical(v.slug, v.code, m.start, m.end);
        return sum + (b ? (measure === "revenue" ? b.revenue : b.collection) : 0);
      }, 0);
  }

  const actualByMonth = new Map<string, number>();
  for (const r of actualRows) {
    actualByMonth.set(r.month_key, (actualByMonth.get(r.month_key) ?? 0) + Number(r.actual));
  }

  const monthRows: TrendMonthRow[] = months.map((m) => ({
    key: m.key,
    label: m.label,
    cells: cellsOf(monthBudgetOf(m), actualByMonth.get(m.key) ?? 0),
  }));
  const monthRowByKey = new Map(monthRows.map((m) => [m.key, m]));

  const elapsed = monthsElapsed(fyStartYear, asOf, entity.fy_start_month);
  const ytd = sumCells(monthRows.slice(0, elapsed).map((m) => m.cells));

  const currentMonth = months.find((m) => m.start <= asOf && asOf <= m.end) ?? months[months.length - 1];
  const currentQuarter = currentMonth.quarter;
  const elapsedInQuarter = Math.max(0, Math.min(3, elapsed - 3 * (currentQuarter - 1)));
  const quarterGroups = groupByQuarter(months);
  const currentQuarterMonths = quarterGroups.find((g) => g.quarter === currentQuarter)?.months ?? [];
  const qtdMonths = currentQuarterMonths
    .slice(0, elapsedInQuarter)
    .map((m) => monthRowByKey.get(m.key)!);

  const quarters: TrendQuarterGroup[] = quarterGroups.map((g) => {
    const qMonths = g.months.map((m) => monthRowByKey.get(m.key)!);
    return {
      quarter: g.quarter,
      label: `Q${g.quarter}`,
      cells: sumCells(qMonths.map((m) => m.cells)),
      months: qMonths,
    };
  });

  return {
    fyStartYear,
    ytd,
    qtd: {
      label: `QTD · Q${currentQuarter}`,
      cells: sumCells(qtdMonths.map((m) => m.cells)),
      months: qtdMonths,
    },
    quarters,
  };
}

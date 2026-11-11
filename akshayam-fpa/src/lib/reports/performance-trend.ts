import { query } from "@/lib/db";
import type { Entity } from "@/lib/entity";
import { profitBeforeTax } from "@/lib/historical-pl";
import { fyLabel, fyMonths, fyStartYearOf } from "@/lib/period";
import { buildProfitAndLoss } from "@/lib/reports/statements";
import { PRESENTATIONAL_TAX_RATE } from "@/lib/reports/presentational-tax";

/**
 * Trend Analysis → Performance: Revenue, Expenses, Profit before tax and Profit after tax for a
 * month, a quarter, a half year or the whole year, beside the same period of each earlier year.
 *
 * Where a month's figures come from:
 *   - the accountant's monthly P&L, where one was uploaded for it (Upload → past years' P&L);
 *   - the General Ledger, for every other month the ledger holds.
 * A month in neither is a gap, shown as such: a period is never summed over the months that
 * happen to exist and passed off as the whole.
 *
 * Both sources are struck the same way - Revenue is fee income; Expenses are the costs of
 * running the firm, depreciation and finance cost included; Other is what is neither (interest
 * and other income, reimbursements recovered net, non-operating items); and
 *
 *   Profit before tax = Revenue - Expenses + Other
 *   Tax               = rate x Profit before tax, where that is a profit (no credit for a loss)
 *   Profit after tax  = Profit before tax - Tax
 *
 * Tax is struck on the period's own profit, not read from the books: the accountant's sheets
 * book none in most months, and where one was booked it is taken out.
 */

export type PeriodKind = "month" | "quarter" | "half" | "year";

export interface PeriodChoice {
  kind: PeriodKind;
  /** month 1..12 of the FY, quarter 1..4, half 1..2; 1 for the year */
  n: number;
}

/** "m7" | "q2" | "h1" | "fy" -> a choice, or null when it is none of those. */
export function parsePeriod(value: string | null): PeriodChoice | null {
  if (!value) return null;
  if (value === "fy") return { kind: "year", n: 1 };
  const m = value.match(/^([mqh])(\d{1,2})$/);
  if (!m) return null;
  const n = Number(m[2]);
  if (m[1] === "m" && n >= 1 && n <= 12) return { kind: "month", n };
  if (m[1] === "q" && n >= 1 && n <= 4) return { kind: "quarter", n };
  if (m[1] === "h" && n >= 1 && n <= 2) return { kind: "half", n };
  return null;
}

export const periodValue = (p: PeriodChoice) =>
  p.kind === "year" ? "fy" : `${p.kind === "month" ? "m" : p.kind === "quarter" ? "q" : "h"}${p.n}`;

/** The FY month positions (1..12) a period spans. */
export function periodMonthIndexes(p: PeriodChoice): number[] {
  switch (p.kind) {
    case "month":
      return [p.n];
    case "quarter":
      return [1, 2, 3].map((i) => (p.n - 1) * 3 + i);
    case "half":
      return Array.from({ length: 6 }, (_, i) => (p.n - 1) * 6 + i + 1);
    case "year":
      return Array.from({ length: 12 }, (_, i) => i + 1);
  }
}

/** The month names of the year in FY order, for building the picker. */
const MONTH_NAMES = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];

export function periodLabel(p: PeriodChoice): string {
  const idx = periodMonthIndexes(p);
  const first = MONTH_NAMES[idx[0] - 1];
  const last = MONTH_NAMES[idx[idx.length - 1] - 1];
  switch (p.kind) {
    case "month":
      return `Month of ${first}`;
    case "quarter":
      return `Quarter ended ${last} (${first}–${last})`;
    case "half":
      return `Half year ended ${last} (${first}–${last})`;
    case "year":
      return `Full year (${first}–${last})`;
  }
}

/** Every choice the picker offers, grouped as the picker shows them. */
export function periodOptions(): { group: string; options: { value: string; label: string }[] }[] {
  const mk = (p: PeriodChoice, label?: string) => ({ value: periodValue(p), label: label ?? periodLabel(p) });
  return [
    {
      group: "Month",
      options: Array.from({ length: 12 }, (_, i) => mk({ kind: "month", n: i + 1 }, MONTH_NAMES[i])),
    },
    { group: "Quarter ended", options: [1, 2, 3, 4].map((n) => mk({ kind: "quarter", n })) },
    { group: "Half year ended", options: [1, 2].map((n) => mk({ kind: "half", n })) },
    { group: "Year", options: [mk({ kind: "year", n: 1 })] },
  ];
}

export interface PerformanceFigures {
  revenue: number;
  expenses: number;
  other: number;
  pbt: number;
  tax: number;
  pat: number;
}

export type MonthSource = "uploaded" | "ledger";

export interface PerformanceColumn {
  fyStartYear: number;
  label: string;
  /** the months the period spans, as "Apr 25" */
  monthLabels: string[];
  /** how many of those months have figures */
  monthsWithData: number;
  /** the months with no figures, as labels */
  missing: string[];
  sources: MonthSource[];
  /** null when no month of the period has figures */
  figures: PerformanceFigures | null;
}

export interface PerformanceTrend {
  period: PeriodChoice;
  fyStartYear: number;
  columns: PerformanceColumn[];
  taxRate: number;
  /** FYs the picker offers, newest first */
  financialYears: number[];
  /** the ledger's last posting date, or null where no ledger is held */
  ledgerThrough: string | null;
  /** the latest month with any figures, "2026-10" */
  latestMonth: string | null;
  /**
   * Set when the period picked includes a month the ledger holds only part of (a ledger pasted to
   * the 27th): that month's figures are to date, not the month's.
   */
  partialMonth: { label: string; through: string } | null;
}

interface MonthFigures {
  revenue: number;
  expenses: number;
  other: number;
  source: MonthSource;
}

function tax(f: { revenue: number; expenses: number; other: number }, rate = 35) {
  const pbt = profitBeforeTax({ revenue: f.revenue, expenses: f.expenses, otherNet: f.other });
  const t = pbt > 0 ? (pbt * rate) / 100 : 0;
  return { pbt, tax: t, pat: pbt - t };
}

/** Every month's figures for the company: the uploaded P&L first, the ledger for the rest. */
async function loadMonths(entity: Entity, wantedFys: number[]): Promise<{
  months: Map<string, MonthFigures>;
  ledgerThrough: string | null;
}> {
  const months = new Map<string, MonthFigures>();

  const uploaded = await query<{
    month_key: string;
    revenue: string;
    expenses: string;
    other_net: string;
  }>(
    `select to_char(month, 'YYYY-MM') as month_key, revenue, expenses, other_net
       from historical_pl_months
      where entity_id = any($1::int[])`,
    [entity.memberIds],
  );
  for (const r of uploaded) {
    const prior = months.get(r.month_key);
    months.set(r.month_key, {
      revenue: (prior?.revenue ?? 0) + Number(r.revenue),
      expenses: (prior?.expenses ?? 0) + Number(r.expenses),
      other: (prior?.other ?? 0) + Number(r.other_net),
      source: "uploaded",
    });
  }

  const ledger = await query<{ month_key: string; last: string }>(
    `select to_char(txn_date, 'YYYY-MM') as month_key, max(txn_date)::text as last
       from gl_entries
      where entity_id = any($1::int[])
      group by 1`,
    [entity.memberIds],
  );
  const ledgerMonths = new Set(ledger.map((r) => r.month_key));
  const ledgerThrough = ledger.reduce<string | null>((a, r) => (a === null || r.last > a ? r.last : a), null);

  for (const fy of wantedFys) {
    const keys = fyMonths(fy).map((m) => m.key);
    // Nothing to read from the ledger for a year it has no month of, or whose every month is uploaded.
    if (!keys.some((k) => ledgerMonths.has(k) && !months.has(k))) continue;

    const pnl = await buildProfitAndLoss({ entity, fyStartYear: fy, detail: false });
    const line = (...codes: string[]) =>
      pnl.lines.filter((l) => l.level === 0 && l.groupCode !== null && codes.includes(l.groupCode));
    const total = (key: string, ...codes: string[]) =>
      line(...codes).reduce((t, l) => t + (l.values[key] ?? 0), 0);

    for (const key of keys) {
      if (!ledgerMonths.has(key) || months.has(key)) continue;
      const revenue = total(key, "revenue", "osb_revenue");
      const other = total(key, "reimbursements", "other_income");
      const pbt = total(key, "pbt");
      // Expenses are everything that took revenue and other income down to profit before tax.
      months.set(key, { revenue, other, expenses: revenue + other - pbt, source: "ledger" });
    }
  }

  return { months, ledgerThrough };
}

export async function buildPerformanceTrend(opts: {
  entity: Entity;
  fyStartYear: number | null;
  period: PeriodChoice | null;
}): Promise<PerformanceTrend> {
  const { entity } = opts;

  // Which years the company has anything for: uploaded months, or the ledger.
  const years = await query<{ fy: number }>(
    `select distinct fy from (
        select case when extract(month from month) >= 4 then extract(year from month)
                    else extract(year from month) - 1 end::int as fy
          from historical_pl_months where entity_id = any($1::int[])
        union
        select case when extract(month from txn_date) >= 4 then extract(year from txn_date)
                    else extract(year from txn_date) - 1 end::int as fy
          from gl_entries where entity_id = any($1::int[])
      ) y order by fy desc`,
    [entity.memberIds],
  );
  const financialYears = years.map((y) => y.fy);
  const fyStart = opts.fyStartYear !== null && financialYears.includes(opts.fyStartYear)
    ? opts.fyStartYear
    : (financialYears[0] ?? fyStartYearOf());

  // The selected year and up to three before it, never earlier than the first year held.
  const earliest = financialYears.length > 0 ? Math.min(...financialYears) : fyStart;
  const wanted: number[] = [];
  for (let y = Math.max(earliest, fyStart - 3); y <= fyStart; y++) wanted.push(y);

  const { months, ledgerThrough } = await loadMonths(entity, wanted);

  // The latest month that has figures at all, for the picker's default.
  const latestMonth = [...months.keys()].sort().pop() ?? null;

  // A period was picked, or default to the latest month with figures.
  let period = opts.period;
  if (!period) {
    const idx = latestMonth ? fyMonths(fyStartOf(latestMonth)).findIndex((m) => m.key === latestMonth) + 1 : 0;
    period = { kind: "month", n: idx > 0 ? idx : 1 };
  }
  const indexes = periodMonthIndexes(period);
  const rate = PRESENTATIONAL_TAX_RATE[entity.slug] ?? 35;

  const columns: PerformanceColumn[] = wanted.map((fy) => {
    const all = fyMonths(fy);
    const span = indexes.map((i) => all[i - 1]);
    const have = span.filter((m) => months.has(m.key));
    const sum = have.reduce(
      (t, m) => {
        const f = months.get(m.key)!;
        return { revenue: t.revenue + f.revenue, expenses: t.expenses + f.expenses, other: t.other + f.other };
      },
      { revenue: 0, expenses: 0, other: 0 },
    );
    return {
      fyStartYear: fy,
      label: fyLabel(fy),
      monthLabels: span.map((m) => m.label),
      monthsWithData: have.length,
      missing: span.filter((m) => !months.has(m.key)).map((m) => m.label),
      sources: [...new Set(have.map((m) => months.get(m.key)!.source))],
      figures: have.length === 0 ? null : { ...sum, ...tax(sum, rate) },
    };
  });

  let partialMonth: PerformanceTrend["partialMonth"] = null;
  if (ledgerThrough) {
    const selected = fyMonths(fyStart);
    const inPeriod = indexes.map((i) => selected[i - 1]).find((m) => m.key === ledgerThrough.slice(0, 7));
    if (inPeriod && months.get(inPeriod.key)?.source === "ledger" && ledgerThrough < inPeriod.end) {
      partialMonth = { label: inPeriod.label, through: ledgerThrough };
    }
  }

  return { period, fyStartYear: fyStart, columns, taxRate: rate, financialYears, ledgerThrough, latestMonth, partialMonth };
}

/** The financial year a "YYYY-MM" month falls in. */
function fyStartOf(monthKey: string): number {
  const [y, m] = monthKey.split("-").map(Number);
  return m >= 4 ? y : y - 1;
}

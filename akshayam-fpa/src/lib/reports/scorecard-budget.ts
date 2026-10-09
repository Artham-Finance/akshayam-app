import type { FyMonth } from "@/lib/period";

/**
 * The revised revenue budget the Vertical Performance Scorecard is rated on.
 *
 * The company revised its revenue budget part-way through FY 2026-27 (the
 * "revenue change" workbook, sheet "latest -30-09-26") because the variable
 * performance pay (VPP) is struck on budget against actual. That file is for
 * the scorecard only: every other budget in the app - the Budget vs Actual
 * statement, the Overview, the Revenue and Collections tabs, the trend tables -
 * keeps reading the budgets already loaded, and is not touched by it.
 *
 * It gives each vertical a figure per quarter, for both companies. A month is a
 * third of its quarter - the budgets for a month inside a quarter are the
 * quarter's figure spread evenly, so a month picked on the scorecard, or a
 * cumulative range, is the sum of its months.
 *
 * The file carries revenue only. Collection is budgeted at 108% of revenue
 * (the firm's standing rule, applied to every vertical and entity), so the
 * collection budget the scorecard rates against is that multiple of the same
 * revised figure - otherwise a vertical whose revenue budget was cut would be
 * rated on collecting a figure its revenue no longer supports.
 *
 * Keyed by the scorecard's own row code, per company. "Raja" is the AIF line of
 * RBJV and "Akshayam" the GIFT line of Akshayam; both land on the one
 * "Raja - AIF & GIFT" row, so the group view adds them.
 */

export const COLLECTION_BUDGET_RATIO = 1.08;

type Quarters = [number, number, number, number];

interface RevisedBudget {
  /** by company slug, then scorecard row code */
  byCompany: Record<string, Record<string, Quarters>>;
  /** where the figures come from, for the note on the page */
  source: string;
}

const REVISED: Record<number, RevisedBudget> = {
  2026: {
    source: "revised budget of 30 Sep 2026",
    byCompany: {
      rbjv: {
        DLR: [5_000_000, 5_000_000, 5_000_000, 5_000_000], // Vijay
        CMRGA: [2_101_061.5, 2_101_061.5, 0, 0], // Gayathri
        CFC: [2_750_000, 2_750_000, 3_250_000, 3_250_000], // Rekha
        RRG: [1_875_000, 1_875_000, 1_875_000, 1_875_000], // Dharshan
        ECM: [1_250_000, 1_250_000, 1_850_000, 1_850_000], // Vasudharini
        GADD: [1_250_000, 1_250_000, 1_900_000, 1_900_000], // Ekta
        COMMON: [625_000, 625_000, 625_000, 625_000],
        AIF_GIFT: [625_000, 625_000, 625_000, 625_000], // Raja
        JIPO: [625_000, 625_000, 625_000, 625_000], // Jayanth - IPO
        HRCM: [0, 0, 0, 0],
        ACC: [0, 0, 0, 0], // Meenakshi
      },
      akshayam: {
        AIF_GIFT: [3_125_000, 3_125_000, 4_625_000, 4_625_000],
      },
    },
  },
};

export interface ScorecardBudget {
  revenue: number;
  collection: number;
}

/**
 * The revised budget for one scorecard row over the months of the window, or
 * null where no revised table exists for the year (the scorecard then reads
 * the budgets already loaded, as before). A row the table does not list has a
 * nil budget under it - the revision removed it.
 */
export function scorecardBudgetFor(
  fyStartYear: number,
  companySlugs: string[],
  rowCode: string,
  months: FyMonth[],
): ScorecardBudget | null {
  const revised = REVISED[fyStartYear];
  if (!revised) return null;
  let revenue = 0;
  for (const slug of companySlugs) {
    const quarters = revised.byCompany[slug]?.[rowCode];
    if (!quarters) continue;
    for (const m of months) revenue += quarters[m.quarter - 1] / 3;
  }
  return { revenue, collection: revenue * COLLECTION_BUDGET_RATIO };
}

/**
 * The revised budget for one vertical over a week (Sunday to Saturday) - the
 * MAK meeting screen's budget. A month is a third of its quarter, and a day
 * is its month's share by calendar days, so a week that straddles two months
 * takes each month's rate for the days it spends in it. Collection is 108% of
 * revenue, as on the scorecard. Null where the year has no revised table.
 */
export function weeklyBudgetFor(
  companySlug: string,
  rowCode: string,
  weekStart: string,
  weekEnd: string,
): ScorecardBudget | null {
  let revenue = 0;
  let any = false;
  for (
    let t = new Date(`${weekStart}T00:00:00Z`).getTime();
    t <= new Date(`${weekEnd}T00:00:00Z`).getTime();
    t += 86_400_000
  ) {
    const d = new Date(t);
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth() + 1; // 1-12
    const fyStartYear = month >= 4 ? year : year - 1;
    const revised = REVISED[fyStartYear];
    if (!revised) continue;
    any = true;
    const quarters = revised.byCompany[companySlug]?.[rowCode];
    if (!quarters) continue;
    const quarter = Math.floor(((month - 4 + 12) % 12) / 3); // 0-3
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    revenue += quarters[quarter] / 3 / daysInMonth;
  }
  return any ? { revenue, collection: revenue * COLLECTION_BUDGET_RATIO } : null;
}

/**
 * The revised quarterly revenue budget by scorecard row, for the companies in
 * scope (summed where more than one holds the same row - Raja's AIF and GIFT),
 * or null where the year has no revised table. For the Scorecard's workbook.
 */
export function revisedQuarterlyTable(
  fyStartYear: number,
  companySlugs: string[],
): Record<string, Quarters> | null {
  const revised = REVISED[fyStartYear];
  if (!revised) return null;
  const out: Record<string, Quarters> = {};
  for (const slug of companySlugs) {
    for (const [rowCode, q] of Object.entries(revised.byCompany[slug] ?? {})) {
      const cur = out[rowCode] ?? [0, 0, 0, 0];
      out[rowCode] = [cur[0] + q[0], cur[1] + q[1], cur[2] + q[2], cur[3] + q[3]];
    }
  }
  return out;
}

/**
 * What the revised budget file says each company's year comes to - typed in once
 * from the file's own totals ("RBJV" and "Akshayam" rows), so the Data checks
 * page can tell when a figure on screen, or the table above, no longer agrees.
 */
export const REVISED_CONTROL_TOTALS: Record<number, Record<string, number>> = {
  2026: { rbjv: 63_702_123, akshayam: 15_500_000 },
};

/** What the revised table holds for a company's year: the sum of every row's four quarters. */
export function revisedCompanyTotal(fyStartYear: number, companySlug: string): number {
  const rows = REVISED[fyStartYear]?.byCompany[companySlug] ?? {};
  return Object.values(rows).reduce((s, q) => s + q[0] + q[1] + q[2] + q[3], 0);
}

/** Whether a revised quarterly budget is held for the year. */
export function hasRevisedBudget(fyStartYear: number): boolean {
  return REVISED[fyStartYear] !== undefined;
}

/**
 * The revised budget for a ledger vertical in a company over any date range -
 * the Overview's budget. The scorecard names AIF and GIFT as one row, so both
 * read that row; every other vertical reads its own, so a company's verticals
 * add up to the revised file's total for it.
 *
 * A budget belongs to a company's own vertical. The row is the sum of RBJV's AIF
 * and Akshayam's GIFT, so a vertical coded GIFT that sits under RBJV (a stray tag
 * in its books) must not read it - it would take RBJV's AIF budget a second time,
 * and the code would then be read against the wrong company. Such a vertical has
 * no budget of its own.
 */
export function revisedBudgetForVertical(
  companySlug: string,
  verticalCode: string,
  start: string,
  end: string,
): ScorecardBudget | null {
  if (verticalCode === "GIFT" && companySlug !== "akshayam") return null;
  if (verticalCode === "AIF" && companySlug !== "rbjv") return null;
  const rowCode = verticalCode === "AIF" || verticalCode === "GIFT" ? "AIF_GIFT" : verticalCode;
  return weeklyBudgetFor(companySlug, rowCode, start, end);
}

/** The note for the page, or null where the year has no revised table. */
export function scorecardBudgetSource(fyStartYear: number): string | null {
  return REVISED[fyStartYear]?.source ?? null;
}

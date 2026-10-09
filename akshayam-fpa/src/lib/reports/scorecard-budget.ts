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
 * Weekly ratings screen's budget. A month is a third of its quarter, and a day
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

/** The note for the page, or null where the year has no revised table. */
export function scorecardBudgetSource(fyStartYear: number): string | null {
  return REVISED[fyStartYear]?.source ?? null;
}

import { queryOne } from "@/lib/db";
import {
  fyBounds,
  fyMonths,
  fyWeeks,
  monthsElapsed,
  weekEndedOnOrBefore,
  type FyMonth,
  type FyWeek,
} from "@/lib/period";

/**
 * What "the period" means on the revenue and collections pages.
 *
 * Three ways to look at the same data, and the budget is pro-rated to match:
 *
 *   ytd     1 April to the last completed reporting week - whole months of
 *           budget, which is the firm's convention
 *   month   one calendar month, a twelfth of the budget
 *   week    one Friday-to-Thursday week, a fifty-second
 *
 * Year to date stops at the last *completed* week rather than the last day of
 * data, so the figure does not move mid-week and a Monday reading is not
 * compared against a Thursday budget. That is also how the firm's own report
 * runs: a ledger pasted to Monday 24 August is reported to Thursday 20 August.
 */
export type PeriodKind = "ytd" | "month" | "week";

/**
 * How far the books have been written up.
 *
 * Taken from the general ledger, not from the invoice or receipt registers.
 * Those can run ahead - RBJV's invoice register carries invoices dated to the
 * end of August while the ledger stops on the 24th - and a period budget that
 * moved depending on which page you were looking at would be indefensible. The
 * ledger is the close, so the ledger sets the period.
 */
export async function ledgerWrittenTo(
  entityIds: number[],
  fyStartYear: number,
): Promise<string | null> {
  const { start, end } = fyBounds(fyStartYear);
  const row = await queryOne<{ d: string | null }>(
    `select max(txn_date)::text as d from gl_entries
      where entity_id = any($1::int[]) and txn_date between $2 and $3`,
    [entityIds, start, end],
  );
  return row?.d ?? null;
}

/** A date range plus the share of the annual budget it earns. */
export interface PeriodWindow {
  start: string;
  end: string;
  label: string;
  /** short form for a column heading, e.g. "Week 21" */
  shortLabel: string;
  fraction: number;
  /** how the fraction was arrived at, said out loud on the page */
  basis: string;
  /**
   * True when the window covers whole calendar months. Retainers are billed
   * monthly, so only a month-aligned window has a defensible share of one.
   */
  monthAligned: boolean;
}

export interface ReportingPeriod extends PeriodWindow {
  kind: PeriodKind;
  /**
   * The year to date up to the end of the chosen week or month.
   *
   * A week on its own says what happened; it does not say whether the year is
   * on track, and one quiet week reads like a crisis without the run-rate
   * beside it. Null when the chosen period *is* the year to date, because
   * showing the same figures twice helps nobody.
   */
  cumulative: PeriodWindow | null;
  months: FyMonth[];
  weeks: FyWeek[];
  /** the picked month or week, when one is picked */
  monthKey: string | null;
  weekNumber: number | null;
}

const MONTHS_IN_YEAR = 12;

function dayMonth(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  const abbr = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d} ${abbr[m - 1]}`;
}

export function resolvePeriod(opts: {
  fyStartYear: number;
  /** the latest date the data actually reaches */
  latest: string | null;
  params: Record<string, string | string[] | undefined>;
}): ReportingPeriod {
  const { fyStartYear, latest, params } = opts;
  const months = fyMonths(fyStartYear);
  const weeks = fyWeeks(fyStartYear);
  const { start: fyStart, end: fyEnd } = fyBounds(fyStartYear);

  const pick = (key: string) => {
    const raw = params[key];
    return typeof raw === "string" && raw ? raw : null;
  };

  /**
   * Year to date up to a chosen week or month end. The budget share is whole
   * months, the same rule the year-to-date view uses - a week ending in August
   * has five months of budget behind it whichever day of August it falls on.
   */
  const cumulativeTo = (end: string, shortLabel: string): PeriodWindow => {
    const elapsed = monthsElapsed(fyStartYear, end);
    return {
      start: fyStart,
      end,
      label: `Year to date · ${dayMonth(fyStart)} - ${dayMonth(end)} ${end.slice(0, 4)}`,
      shortLabel,
      fraction: elapsed / MONTHS_IN_YEAR,
      basis: `${elapsed} month${elapsed === 1 ? "" : "s"} of 12`,
      monthAligned: true,
    };
  };

  const weekParam = Number(pick("week"));
  const week = weeks.find((w) => w.number === weekParam);
  if (week) {
    return {
      kind: "week",
      start: week.start,
      end: week.end,
      label: `${week.label} ${fyStartYear}`,
      shortLabel: `Week ${week.number}`,
      fraction: 1 / weeks.length,
      basis: `one week of ${weeks.length}`,
      monthAligned: false,
      cumulative: cumulativeTo(week.end, `Up to week ${week.number}`),
      months,
      weeks,
      monthKey: null,
      weekNumber: week.number,
    };
  }

  const monthParam = pick("month");
  const month = months.find((m) => m.key === monthParam);
  if (month) {
    return {
      kind: "month",
      start: month.start,
      end: month.end,
      label: `${month.label} · ${dayMonth(month.start)} - ${dayMonth(month.end)}`,
      shortLabel: month.label,
      fraction: 1 / MONTHS_IN_YEAR,
      basis: "one month of 12",
      monthAligned: true,
      cumulative: cumulativeTo(month.end, `Up to ${month.label}`),
      months,
      weeks,
      monthKey: month.key,
      weekNumber: null,
    };
  }

  // Year to date, stopping at the last week that has finished. Before the first
  // week ends there is nothing complete to report, so the whole year is used
  // and the budget follows the data.
  const dataEnd = latest && latest < fyEnd ? latest : fyEnd;
  const lastCompleteWeek = weekEndedOnOrBefore(weeks, dataEnd);
  const end = lastCompleteWeek ? lastCompleteWeek.end : dataEnd;
  const elapsed = monthsElapsed(fyStartYear, end);

  return {
    kind: "ytd",
    start: fyStart,
    end,
    label: `Year to date · ${dayMonth(fyStart)} - ${dayMonth(end)} ${end.slice(0, 4)}`,
    shortLabel: "Year to date",
    fraction: elapsed / MONTHS_IN_YEAR,
    basis: `${elapsed} month${elapsed === 1 ? "" : "s"} of 12`,
    monthAligned: true,
    // Already the year to date; a second identical set of columns is noise.
    cumulative: null,
    months,
    weeks,
    monthKey: null,
    weekNumber: null,
  };
}

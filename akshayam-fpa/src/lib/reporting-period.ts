import { cookies } from "next/headers";
import { addDays, endOfMonth, startOfMonth, subMonths } from "date-fns";
import { queryOne } from "@/lib/db";
import type { Entity } from "@/lib/entity";
import { dateLabel } from "@/lib/format";
import {
  PRESET_IDS,
  type PeriodCookie,
  type PresetId,
} from "@/lib/period-presets";
import {
  fyBounds,
  fyLabel,
  fyMonths,
  fyStartYearOf,
  fyWeeks,
  monthsElapsed,
  quarterLabel,
  weekEndedOnOrBefore,
  type FyMonth,
  type FyWeek,
  type QuarterNo,
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

/**
 * What every ledger-driven report should say about how current it is - one
 * phrase, so a partner reading the P&L one tab and Cash Flow the next never
 * has to wonder whether the two are speaking as of different days.
 *
 * Null before anything has posted this year, which the pages that call this
 * already treat as "nothing to report" long before the subtitle is built.
 */
export function ledgerAsOfLabel(writtenTo: string | null): string | null {
  return writtenTo ? `ledger posted through ${dateLabel(writtenTo)}` : null;
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

/* ============================================================
   The global reporting period - the header date-range picker.

   `resolvePeriod` above still serves the week/month sub-views on the
   revenue and collections pages. This is the layer that chooses the
   window itself: one choice, held in a cookie like the company picker,
   that every report tab reads. Every window is confined to one financial
   year - the whole engine (opening/closing balance-sheet cut, budgets
   keyed by fy_start_year, months elapsed) is built a year at a time.
   ============================================================ */

export const PERIOD_COOKIE = "fpa_period";

export {
  PRESET_IDS,
  PRESET_LABEL,
  type PresetId,
  type PeriodCookie,
} from "@/lib/period-presets";

const DEFAULT_PERIOD: PeriodCookie = { preset: "ytd" };
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isPresetId(v: unknown): v is PresetId {
  return typeof v === "string" && (PRESET_IDS as readonly string[]).includes(v);
}

/**
 * The picker's stored choice, validated, or year-to-date when there is none
 * or it is malformed. Safe to call at render time - returns the default
 * outside a request scope, exactly like `slugFromCookie` in entity.ts.
 */
export async function readReportingPeriodCookie(): Promise<PeriodCookie> {
  try {
    const raw = (await cookies()).get(PERIOD_COOKIE)?.value;
    if (!raw) return DEFAULT_PERIOD;
    const parsed = JSON.parse(raw) as Partial<PeriodCookie>;
    if (!isPresetId(parsed.preset)) return DEFAULT_PERIOD;
    if (parsed.preset === "custom") {
      const { from, to } = parsed;
      if (
        typeof from !== "string" ||
        typeof to !== "string" ||
        !ISO_DATE.test(from) ||
        !ISO_DATE.test(to) ||
        from > to
      ) {
        return DEFAULT_PERIOD;
      }
      return { preset: "custom", from, to };
    }
    return { preset: parsed.preset };
  } catch {
    return DEFAULT_PERIOD;
  }
}

export type PeriodKindWide =
  | "day"
  | "week"
  | "month"
  | "mtd"
  | "quarter"
  | "qtd"
  | "year"
  | "ytd"
  | "custom";

export interface ReportingPeriodResolved {
  preset: PresetId;
  /** the single financial year the whole window sits in */
  fyStartYear: number;
  start: string;
  end: string;
  /** = end; balance sheet and DuPont read the position as at this date */
  asOf: string;
  label: string;
  /** short form for a column heading or the picker button */
  shortLabel: string;
  basis: string;
  /** true when the window covers whole calendar months exactly */
  monthAligned: boolean;
  /** whole FY months the window touches - the budget "snap to months" */
  periodMonths: FyMonth[];
  fraction: number;
  monthsElapsed: number;
  kind: PeriodKindWide;
  /** the year to date up to `end`, when the window is not already that */
  cumulative: PeriodWindow | null;
  /** set when the picked period fell in a year the ledger has no data for */
  note: string | null;
}

const KIND_OF: Record<PresetId, PeriodKindWide> = {
  today: "day",
  prev_day: "day",
  this_week: "week",
  prev_week: "week",
  this_month: "month",
  prev_month: "month",
  mtd: "mtd",
  qtd: "qtd",
  this_quarter: "quarter",
  prev_quarter: "quarter",
  this_year: "year",
  prev_year: "year",
  ytd: "ytd",
  custom: "custom",
};

/** "To date" windows stop at whatever the ledger has actually posted. */
const TO_DATE = new Set<PresetId>(["mtd", "qtd", "ytd"]);

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Local-time YYYY-MM-DD, matching how fyStartYearOf reads a date. */
const localIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;

/** The FY quarter's months that a date falls in. */
function quarterMonthsOf(
  fyStartYear: number,
  dateIso: string,
  fyStartMonth: number,
): FyMonth[] {
  const months = fyMonths(fyStartYear, fyStartMonth);
  const hit =
    months.find((m) => m.start <= dateIso && dateIso <= m.end) ??
    months[months.length - 1];
  return months.filter((m) => m.quarter === hit.quarter);
}

interface RawWindow {
  start: string;
  end: string;
  /** the FY the window belongs to, before it is confined */
  fy: number;
}

function rawWindow(
  cookie: PeriodCookie,
  today: Date,
  fyStartMonth: number,
): RawWindow {
  const t = localIso(today);
  const fyToday = fyStartYearOf(today, fyStartMonth);
  const fyOf = (iso: string) =>
    fyStartYearOf(new Date(`${iso}T00:00:00`), fyStartMonth);

  switch (cookie.preset) {
    case "custom": {
      const start = cookie.from ?? t;
      const end = cookie.to ?? t;
      return { start, end, fy: fyOf(start) };
    }
    case "today":
      return { start: t, end: t, fy: fyToday };
    case "prev_day": {
      const d = localIso(addDays(today, -1));
      return { start: d, end: d, fy: fyOf(d) };
    }
    case "this_week":
    case "prev_week": {
      // Week 1 of a FY starts a few days before 1 April, so a "this week"
      // in early April can belong to the tail of the prior FY's weeks.
      const weeks = [
        ...fyWeeks(fyToday - 1, fyStartMonth),
        ...fyWeeks(fyToday, fyStartMonth),
      ];
      const at = weeks.findIndex((w) => w.start <= t && t <= w.end);
      const here = at >= 0 ? at : weeks.length - 1;
      const w = weeks[cookie.preset === "prev_week" ? Math.max(0, here - 1) : here];
      return { start: w.start, end: w.end, fy: fyOf(w.start) };
    }
    case "this_month":
      return {
        start: localIso(startOfMonth(today)),
        end: localIso(endOfMonth(today)),
        fy: fyToday,
      };
    case "mtd":
      return { start: localIso(startOfMonth(today)), end: t, fy: fyToday };
    case "prev_month": {
      const p = subMonths(today, 1);
      return {
        start: localIso(startOfMonth(p)),
        end: localIso(endOfMonth(p)),
        fy: fyOf(localIso(startOfMonth(p))),
      };
    }
    case "this_quarter": {
      const qm = quarterMonthsOf(fyToday, t, fyStartMonth);
      return { start: qm[0].start, end: qm[qm.length - 1].end, fy: fyToday };
    }
    case "qtd": {
      const qm = quarterMonthsOf(fyToday, t, fyStartMonth);
      return { start: qm[0].start, end: t, fy: fyToday };
    }
    case "prev_quarter": {
      const q = quarterMonthsOf(fyToday, t, fyStartMonth)[0].quarter;
      const fy = q === 1 ? fyToday - 1 : fyToday;
      const target = q === 1 ? 4 : ((q - 1) as QuarterNo);
      const pm = fyMonths(fy, fyStartMonth).filter((m) => m.quarter === target);
      return { start: pm[0].start, end: pm[pm.length - 1].end, fy };
    }
    case "this_year": {
      const b = fyBounds(fyToday, fyStartMonth);
      return { start: b.start, end: b.end, fy: fyToday };
    }
    case "ytd": {
      const b = fyBounds(fyToday, fyStartMonth);
      return { start: b.start, end: t, fy: fyToday };
    }
    case "prev_year": {
      const b = fyBounds(fyToday - 1, fyStartMonth);
      return { start: b.start, end: b.end, fy: fyToday - 1 };
    }
  }
}

function describe(
  preset: PresetId,
  start: string,
  end: string,
  fyStartYear: number,
  months: FyMonth[],
): { label: string; shortLabel: string } {
  const year = end.slice(0, 4);
  const span =
    start === end
      ? `${dayMonth(start)} ${year}`
      : `${dayMonth(start)} - ${dayMonth(end)} ${year}`;
  const quarterAt = (iso: string): QuarterNo =>
    months.find((m) => m.start <= iso && iso <= m.end)?.quarter ?? 1;

  switch (KIND_OF[preset]) {
    case "day":
      return {
        label: `${dayMonth(start)} ${year}`,
        shortLabel: preset === "prev_day" ? "Prev day" : "Today",
      };
    case "week":
      return {
        label: `Week of ${span}`,
        shortLabel: preset === "prev_week" ? "Prev week" : "This week",
      };
    case "month":
      return {
        label: `${MONTH_NAMES[Number(start.slice(5, 7)) - 1]} ${year}`,
        shortLabel: preset === "prev_month" ? "Prev month" : "This month",
      };
    case "mtd":
      return {
        label: `${MONTH_NAMES[Number(start.slice(5, 7)) - 1]} to date · ${span}`,
        shortLabel: "MTD",
      };
    case "quarter":
      return {
        label: `${quarterLabel(quarterAt(start), months)} ${year}`,
        shortLabel: preset === "prev_quarter" ? "Prev quarter" : "This quarter",
      };
    case "qtd":
      return {
        label: `${quarterLabel(quarterAt(start), months)} to date · ${span}`,
        shortLabel: "QTD",
      };
    case "year":
      return {
        label: fyLabel(fyStartYear),
        shortLabel: preset === "prev_year" ? "Prev year" : "This year",
      };
    case "ytd":
      return { label: `Year to date · ${span}`, shortLabel: "Year to date" };
    case "custom":
      return { label: span, shortLabel: span };
  }
}

/**
 * Resolve the header picker's choice into a concrete window, confined to one
 * financial year. `ledgerWrittenTo` (the general-ledger close date) caps the
 * "to date" presets so a report never runs past the books.
 */
export async function getReportingPeriod(
  entity: Entity,
  availableYears: number[],
  ledgerWrittenTo?: string | null,
): Promise<ReportingPeriodResolved> {
  const fyStartMonth = entity.fy_start_month ?? 4;
  const cookie = await readReportingPeriodCookie();
  const raw = rawWindow(cookie, new Date(), fyStartMonth);

  let fyStartYear = raw.fy;
  let note: string | null = null;

  // Confine the window to its financial year.
  let bounds = fyBounds(fyStartYear, fyStartMonth);
  let start = raw.start < bounds.start ? bounds.start : raw.start;
  let end = raw.end > bounds.end ? bounds.end : raw.end;

  // The picked period is in a year the ledger has no data for - fall back to
  // the latest year's date-to-date and say so.
  if (availableYears.length > 0 && !availableYears.includes(fyStartYear)) {
    fyStartYear = availableYears[0];
    bounds = fyBounds(fyStartYear, fyStartMonth);
    start = bounds.start;
    end =
      ledgerWrittenTo && ledgerWrittenTo < bounds.end
        ? ledgerWrittenTo
        : bounds.end;
    note =
      "The chosen period is in a year with no ledger yet - showing the latest year.";
  } else if (TO_DATE.has(cookie.preset) && ledgerWrittenTo && ledgerWrittenTo < end) {
    end = ledgerWrittenTo;
  } else if (
    cookie.preset === "custom" &&
    raw.end > localIso(new Date()) &&
    ledgerWrittenTo &&
    ledgerWrittenTo < end
  ) {
    // A custom range whose end is in the future stops at the ledger.
    end = ledgerWrittenTo;
  }

  if (end < start) end = start; // corrupt cookie guard

  const monthList = fyMonths(fyStartYear, fyStartMonth);
  const periodMonths = monthList.filter((m) => m.start <= end && m.end >= start);
  const monthsIn = periodMonths.length;
  // "Whole months" the firm's way: a window that starts on the first of a month
  // covers whole months of budget, a trailing part-month counting in full - the
  // same rule `monthsElapsed` and the retainer share already use.
  const monthAligned = monthsIn > 0 && start === periodMonths[0].start;

  const { label, shortLabel } = describe(
    cookie.preset,
    start,
    end,
    fyStartYear,
    monthList,
  );

  const cumulative: PeriodWindow | null =
    start === bounds.start
      ? null
      : {
          start: bounds.start,
          end,
          label: `Year to date · ${dayMonth(bounds.start)} - ${dayMonth(end)} ${end.slice(0, 4)}`,
          shortLabel: "Year to date",
          fraction: monthsElapsed(fyStartYear, end, fyStartMonth) / MONTHS_IN_YEAR,
          basis: `${monthsElapsed(fyStartYear, end, fyStartMonth)} months of 12`,
          monthAligned: true,
        };

  return {
    preset: cookie.preset,
    fyStartYear,
    start,
    end,
    asOf: end,
    label,
    shortLabel,
    basis: `${monthsIn} month${monthsIn === 1 ? "" : "s"} of 12`,
    monthAligned,
    periodMonths,
    fraction: monthsIn / MONTHS_IN_YEAR,
    monthsElapsed: monthsIn,
    kind: KIND_OF[cookie.preset],
    cumulative,
    note,
  };
}

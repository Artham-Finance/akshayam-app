/**
 * Indian financial year periods: April to March, quarters Q1 Apr-Jun ... Q4 Jan-Mar.
 *
 * Statement columns are always built from months. Quarters are month sums
 * computed on the client, which is what lets a quarter column expand into its
 * three months without another round trip to the server.
 */

export type QuarterNo = 1 | 2 | 3 | 4;

export interface FyMonth {
  /** "2025-04" - stable key for lookups */
  key: string;
  /** first day, "2025-04-01" */
  start: string;
  /** last day, "2025-04-30" */
  end: string;
  /** "Apr 25" */
  label: string;
  /** 1-based position in the financial year, 1..12 */
  index: number;
  quarter: QuarterNo;
}

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const pad = (n: number) => String(n).padStart(2, "0");

/** Last calendar day of a given year/month (month is 1-based). */
function lastDay(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * The twelve months of a financial year.
 * @param fyStartYear the calendar year the FY begins in - 2025 means FY 2025-26.
 */
export function fyMonths(fyStartYear: number, fyStartMonth = 4): FyMonth[] {
  const months: FyMonth[] = [];
  for (let i = 0; i < 12; i++) {
    const raw = fyStartMonth + i;
    const month = ((raw - 1) % 12) + 1;
    const year = fyStartYear + Math.floor((raw - 1) / 12);
    months.push({
      key: `${year}-${pad(month)}`,
      start: `${year}-${pad(month)}-01`,
      end: `${year}-${pad(month)}-${pad(lastDay(year, month))}`,
      label: `${MONTH_ABBR[month - 1]} ${String(year).slice(2)}`,
      index: i + 1,
      quarter: (Math.floor(i / 3) + 1) as QuarterNo,
    });
  }
  return months;
}

/** "FY 2025-26" */
export function fyLabel(fyStartYear: number): string {
  return `FY ${fyStartYear}-${String(fyStartYear + 1).slice(2)}`;
}

/** "Q1" plus the month span it covers, e.g. "Q1 Apr-Jun". */
export function quarterLabel(quarter: QuarterNo, months: FyMonth[]): string {
  const inQuarter = months.filter((m) => m.quarter === quarter);
  if (inQuarter.length === 0) return `Q${quarter}`;
  const first = inQuarter[0].label.split(" ")[0];
  const last = inQuarter[inQuarter.length - 1].label.split(" ")[0];
  return `Q${quarter} ${first}-${last}`;
}

/** The FY that a given date falls in. Defaults to today. */
export function fyStartYearOf(date: Date = new Date(), fyStartMonth = 4): number {
  const month = date.getMonth() + 1;
  return month >= fyStartMonth ? date.getFullYear() : date.getFullYear() - 1;
}

/** First and last day of a financial year. */
export function fyBounds(fyStartYear: number, fyStartMonth = 4) {
  const months = fyMonths(fyStartYear, fyStartMonth);
  return { start: months[0].start, end: months[11].end };
}

/* ============================================================
   Reporting weeks
   ============================================================ */

/**
 * The firm's week runs Friday to Thursday, and week 1 is the one ending on the
 * first Thursday of the financial year - for FY 2026-27 that is the week of
 * Fri 27 Mar to Thu 2 Apr 2026. Week 1 therefore starts a few days before the
 * year does, which is deliberate: the week is the unit the firm reports on, and
 * splitting it at the year end would leave a stub nobody recognises.
 */
export interface FyWeek {
  number: number;
  /** Friday, "2026-03-27" */
  start: string;
  /** Thursday, "2026-04-02" */
  end: string;
  /** "Week 21 · 14-20 Aug" */
  label: string;
}

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const parse = (s: string) => new Date(`${s}T00:00:00Z`);

/** The day of the week the reporting week ends on: Thursday. */
const WEEK_ENDS_ON = 4;

function firstWeekEnd(fyStartYear: number, fyStartMonth: number): Date {
  const start = new Date(Date.UTC(fyStartYear, fyStartMonth - 1, 1));
  const shift = (WEEK_ENDS_ON - start.getUTCDay() + 7) % 7;
  return new Date(start.getTime() + shift * DAY);
}

/** Every reporting week of a financial year, in order. */
export function fyWeeks(fyStartYear: number, fyStartMonth = 4): FyWeek[] {
  const yearEnd = parse(fyBounds(fyStartYear, fyStartMonth).end);
  const weeks: FyWeek[] = [];
  let end = firstWeekEnd(fyStartYear, fyStartMonth);

  for (let n = 1; end.getTime() <= yearEnd.getTime() + 6 * DAY; n++) {
    const start = new Date(end.getTime() - 6 * DAY);
    const sameMonth = start.getUTCMonth() === end.getUTCMonth();
    const from = sameMonth
      ? String(start.getUTCDate())
      : `${start.getUTCDate()} ${MONTH_ABBR[start.getUTCMonth()]}`;
    weeks.push({
      number: n,
      start: iso(start),
      end: iso(end),
      label: `Week ${n} · ${from}-${end.getUTCDate()} ${MONTH_ABBR[end.getUTCMonth()]}`,
    });
    end = new Date(end.getTime() + 7 * DAY);
  }
  return weeks;
}

/** The reporting week a date falls in, or the last one that has finished. */
export function weekEndedOnOrBefore(weeks: FyWeek[], date: string): FyWeek | null {
  let found: FyWeek | null = null;
  for (const week of weeks) {
    if (week.end <= date) found = week;
    else break;
  }
  return found;
}

/**
 * Whole months of the financial year covered by a period ending on `end`.
 *
 * A part-month counts in full: a ledger pasted to 24 August has five months of
 * budget behind it, not four and three-quarters. That is the firm's own
 * convention and it is what makes the period budget a round twelfth multiple.
 */
export function monthsElapsed(fyStartYear: number, end: string, fyStartMonth = 4): number {
  const months = fyMonths(fyStartYear, fyStartMonth);
  const count = months.filter((m) => m.start <= end).length;
  return Math.min(12, Math.max(0, count));
}

/** Group months into quarters, preserving order. */
export function groupByQuarter(months: FyMonth[]): { quarter: QuarterNo; months: FyMonth[] }[] {
  const out: { quarter: QuarterNo; months: FyMonth[] }[] = [];
  for (const month of months) {
    const last = out[out.length - 1];
    if (last && last.quarter === month.quarter) last.months.push(month);
    else out.push({ quarter: month.quarter, months: [month] });
  }
  return out;
}

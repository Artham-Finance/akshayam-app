import { rateBudgetAchievement } from "@/lib/reports/scorecard-rating";

/**
 * The weekly meeting's calendar and rules - free of any database import, so the
 * page, the API and a script can all read the same ones.
 *
 * A week runs Sunday to Saturday and is named by the Saturday it ends on, the
 * day of the weekly meeting. The MAK meeting starts with the first week that ends
 * in October 2026; nothing before it is offered.
 */

export const WEEKLY_FIRST_WEEK_END = "2026-10-03";
/** the last week offered: the one ending on the last Saturday of the financial year, plus the one after */
const WEEKLY_LAST_WEEK_END = "2027-04-03";

export const WEEKLY_MEASURES = ["revenue", "collection"] as const;
export type WeeklyMeasure = (typeof WEEKLY_MEASURES)[number];

export const WEEKLY_MEASURE_LABEL: Record<WeeklyMeasure, string> = {
  revenue: "Revenue",
  collection: "Collection",
};

const DAY = 86_400_000;
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const parse = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(date: string, days: number): string {
  return iso(new Date(parse(date).getTime() + days * DAY));
}

export function isSaturday(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && parse(date).getUTCDay() === 6;
}

export interface MeetingWeek {
  number: number;
  /** the Sunday */
  start: string;
  /** the Saturday - also the week's name */
  end: string;
  label: string;
}

const dayMonth = (d: Date) => `${d.getUTCDate()} ${MONTH_ABBR[d.getUTCMonth()]}`;

/** Every week offered on the screen, in order. */
export function meetingWeeks(): MeetingWeek[] {
  const weeks: MeetingWeek[] = [];
  let end = WEEKLY_FIRST_WEEK_END;
  for (let n = 1; end <= WEEKLY_LAST_WEEK_END; n++) {
    const start = addDays(end, -6);
    weeks.push({
      number: n,
      start,
      end,
      label: `Week ${n} · ${dayMonth(parse(start))} - ${dayMonth(parse(end))}`,
    });
    end = addDays(end, 7);
  }
  return weeks;
}

/** The week a date falls in: the one ending on the next Saturday on or after it. */
export function weekEndOf(date: string): string {
  const day = parse(date).getUTCDay(); // 0 = Sunday ... 6 = Saturday
  return addDays(date, (6 - day + 7) % 7);
}

/** The week to open on: the current one, but never earlier than the first offered. */
export function defaultWeekEnd(today: string): string {
  const end = weekEndOf(today);
  return end < WEEKLY_FIRST_WEEK_END ? WEEKLY_FIRST_WEEK_END : end;
}

/** The Saturday meeting a week's commitment is normally made at: the Saturday before it begins. */
export function defaultMeetingDate(weekEnd: string): string {
  return addDays(weekEnd, -7);
}

/** Today's date in India, whatever the server's own clock says. */
export function todayIst(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/**
 * Whether a commitment's amounts are frozen: from the day after it was first
 * keyed, unless an admin has reopened it for today.
 */
export function isLocked(enteredOn: string, reopenedOn: string | null, today: string): boolean {
  if (today <= enteredOn) return false;
  return reopenedOn !== today;
}

/**
 * A figure rated against the weekly budget, on the Vertical Performance
 * Scorecard's bands: 100% or more is 4, over 80% is 3, over 60% is 2, over 40%
 * is 1, otherwise 0. Null where there is no budget to measure against.
 */
export function ratingVsBudget(value: number, budget: number | null): number | null {
  if (budget === null || !(budget > 0)) return null;
  return rateBudgetAchievement(value / budget);
}

/**
 * What was actually achieved against what was committed, on
 * the Vertical Performance Scorecard's own bands (4 at 100% or more, then
 * above 80%, 60%, 40%). Null where nothing was committed - there is nothing to
 * rate against.
 */
export function weeklyRating(actual: number, committed: number): number | null {
  if (!(committed > 0)) return null;
  return rateBudgetAchievement(actual / committed);
}

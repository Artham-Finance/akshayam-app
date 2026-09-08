/**
 * The reporting-period presets - just the names, labels and cookie shape.
 *
 * Split out from `reporting-period.ts` (which pulls in the database and
 * `next/headers`) so the client-side `<PeriodPicker>` can import the labels
 * without dragging server code into the browser bundle.
 */

export const PRESET_IDS = [
  "today",
  "this_week",
  "this_month",
  "mtd",
  "this_quarter",
  "qtd",
  "this_year",
  "ytd",
  "prev_day",
  "prev_week",
  "prev_month",
  "prev_quarter",
  "prev_year",
  "custom",
] as const;
export type PresetId = (typeof PRESET_IDS)[number];

export const PRESET_LABEL: Record<Exclude<PresetId, "custom">, string> = {
  today: "Today",
  this_week: "This week",
  this_month: "This month",
  mtd: "Month to date",
  this_quarter: "This quarter",
  qtd: "Quarter to date",
  this_year: "This year",
  ytd: "Year to date",
  prev_day: "Previous day",
  prev_week: "Previous week",
  prev_month: "Previous month",
  prev_quarter: "Previous quarter",
  prev_year: "Previous year",
};

export interface PeriodCookie {
  preset: PresetId;
  /** only when preset === "custom" */
  from?: string;
  to?: string;
}

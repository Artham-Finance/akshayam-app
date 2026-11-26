import { query, queryOne } from "@/lib/db";
import { verticalScope, type Entity } from "@/lib/entity";
import { fyBounds, monthsElapsed } from "@/lib/period";
import { ledgerWrittenTo } from "@/lib/reporting-period";
import { buildBudgetVsActual, type BudgetRow, type BudgetWindow } from "@/lib/reports/budget";
import { AR_BUCKETS, arBucketSelect } from "@/lib/reports/drilldowns";
import { addDays } from "@/lib/weekly";
import { dateLabel } from "@/lib/format";

/**
 * The Monday and Friday evening update, for one entity (a company, the group, or one
 * partner's slice): revenue and collection, week to date / month to date / year to date, each
 * against its budget, and the receivables by age.
 *
 * It is the same figures the Revenue, Collections and Receivables pages carry - the revised
 * quarterly budget, the ledger's revenue, fee receipts, the latest receivables snapshot - read
 * through the same builders, so an email never disagrees with the page it was drawn from. As on
 * those pages, a month's and the year's budget is struck on whole months; the week's on its days.
 */

export interface DigestPeriod {
  /** "Week to date" */
  title: string;
  /** "26 Nov 2026" or "22 Nov - 26 Nov 2026" */
  range: string;
  rows: BudgetRow[];
  total: BudgetRow;
}

export interface DigestAgeRow {
  name: string;
  /** by ageing band, in AR_BUCKETS order */
  buckets: number[];
  total: number;
}

export interface DigestContent {
  entity: { id: number; slug: string; name: string };
  /** the day the update is for */
  asOf: string;
  /** the ledger's latest posting this year, or null if none */
  glThrough: string | null;
  /** the ledger has a posting on or after the week's first day */
  glThisWeek: boolean;
  /** the latest receipt loaded, or null */
  receiptsThrough: string | null;
  /** the receivables snapshot read, or null if none */
  receivablesAsOf: string | null;
  revenue: DigestPeriod[];
  collection: DigestPeriod[];
  receivables: { bands: string[]; rows: DigestAgeRow[]; total: DigestAgeRow } | null;
}

const parse = (d: string) => new Date(`${d}T00:00:00Z`);

/** The financial year (by its starting calendar year) a date falls in. */
function fyOf(date: string): number {
  const [y, m] = date.split("-").map(Number);
  return m >= 4 ? y : y - 1;
}

/** The three windows an update reports over, ending on `asOf`. */
export function digestWindows(asOf: string): { title: string; window: BudgetWindow }[] {
  const fy = fyOf(asOf);
  const fyStart = fyBounds(fy).start;
  const weekStartRaw = addDays(asOf, -parse(asOf).getUTCDay()); // the Sunday this week began
  const weekStart = weekStartRaw < fyStart ? fyStart : weekStartRaw;
  const monthStart = `${asOf.slice(0, 7)}-01`;
  const days = Math.round((parse(asOf).getTime() - parse(weekStart).getTime()) / 86_400_000) + 1;

  return [
    {
      title: "Week to date",
      // The week's budget is its days' share; the retainer split does not apply to a week.
      window: { start: weekStart, end: asOf, fraction: days / 365, monthAligned: false },
    },
    {
      title: "Month to date",
      window: { start: monthStart, end: asOf, fraction: 1 / 12, monthAligned: true },
    },
    {
      title: "Year to date",
      window: { start: fyStart, end: asOf, fraction: monthsElapsed(fy, asOf) / 12, monthAligned: true },
    },
  ];
}

const rangeLabel = (w: BudgetWindow) =>
  w.start === w.end ? dateLabel(w.end) : `${dateLabel(w.start)} - ${dateLabel(w.end)}`;

export async function buildDigest(entity: Entity, asOf: string): Promise<DigestContent> {
  const fy = fyOf(asOf);
  const windows = digestWindows(asOf);

  const periodsFor = async (measure: "revenue" | "collection"): Promise<DigestPeriod[]> =>
    Promise.all(
      windows.map(async ({ title, window }) => {
        const data = await buildBudgetVsActual({
          entity,
          fyStartYear: fy,
          measure,
          revised: true,
          period: window,
        });
        // A vertical with nothing budgeted and nothing done adds only a row of dashes.
        const rows = data.rows.filter((r) => r.period.periodBudget !== 0 || r.period.actual !== 0);
        return { title, range: rangeLabel(window), rows, total: data.total };
      }),
    );

  const [revenue, collection, glThrough, receipts, receivables] = await Promise.all([
    periodsFor("revenue"),
    periodsFor("collection"),
    ledgerWrittenTo(entity.memberIds, fy),
    queryOne<{ d: string | null }>(
      `select max(p.payment_date)::text as d
         from payments p
        where p.entity_id = any($1::int[])`,
      [entity.memberIds],
    ),
    buildAgeing(entity),
  ]);

  return {
    entity: { id: entity.id, slug: entity.slug, name: entity.name },
    asOf,
    glThrough,
    glThisWeek: glThrough !== null && glThrough >= windows[0].window.start,
    receiptsThrough: receipts?.d ?? null,
    receivablesAsOf: receivables?.asOf ?? null,
    revenue,
    collection,
    receivables: receivables?.table ?? null,
  };
}

/** What is owed, by vertical and age, on each company's latest receivables snapshot. */
async function buildAgeing(
  entity: Entity,
): Promise<{ asOf: string; table: NonNullable<DigestContent["receivables"]> } | null> {
  const snap = await queryOne<{ as_of: string | null }>(
    `select max(a.as_of)::text as as_of
       from ar_open_items a
      where a.entity_id = any($1::int[])
        ${verticalScope("$2", "a.vertical_id")}`,
    [entity.memberIds, entity.verticalIds],
  );
  if (!snap?.as_of) return null;

  const rows = await query<Record<string, string | number | null>>(
    `select v.name, ${arBucketSelect("a.")},
            coalesce(sum(a.balance_base), 0)::numeric as total
       from ar_open_items a
       left join verticals v on v.id = a.vertical_id
      where (a.entity_id, a.as_of) in (
              select entity_id, max(as_of) from ar_open_items
               where entity_id = any($1::int[]) group by entity_id)
        ${verticalScope("$2", "a.vertical_id")}
      group by v.id, v.name
      order by total desc`,
    [entity.memberIds, entity.verticalIds],
  );

  const toRow = (r: Record<string, string | number | null>): DigestAgeRow => ({
    name: (r.name as string | null) ?? "Not attributed to a vertical",
    buckets: AR_BUCKETS.map((b) => Number(r[b.key] ?? 0)),
    total: Number(r.total ?? 0),
  });
  const list = rows.map(toRow).filter((r) => r.total !== 0 || r.buckets.some((n) => n !== 0));
  const total: DigestAgeRow = {
    name: "Total",
    buckets: AR_BUCKETS.map((_, i) => list.reduce((s, r) => s + r.buckets[i], 0)),
    total: list.reduce((s, r) => s + r.total, 0),
  };

  return {
    asOf: snap.as_of,
    table: { bands: AR_BUCKETS.map((b) => b.label), rows: list, total },
  };
}

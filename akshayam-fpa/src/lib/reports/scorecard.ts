import { query } from "@/lib/db";
import type { Entity } from "@/lib/entity";
import { fyMonths, type QuarterNo } from "@/lib/period";
import { buildApportionment } from "@/lib/reports/apportionment";
import { buildBudgetVsActual } from "@/lib/reports/budget";
import {
  MGMT_APPRAISAL_DEFAULT,
  rateAgeingDays,
  rateBudgetAchievement,
  rateContributionShare,
  WEIGHTS,
} from "@/lib/reports/scorecard-rating";

export {
  MGMT_APPRAISAL_DEFAULT,
  rateAgeingDays,
  rateBudgetAchievement,
  rateContributionShare,
  WEIGHTS,
} from "@/lib/reports/scorecard-rating";

/**
 * Vertical Performance Scorecard.
 *
 * Reproduces the partners' quarterly "TL Performance Rating" workbook: six
 * metrics per vertical, each scored 0-4, rolled into one weighted composite.
 * Every input comes from the app's own data - GL revenue, collections, the
 * apportioned cost pool, and the AR snapshot - so it can be struck for any
 * quarter without re-keying a spreadsheet.
 */

/** Bucket day-boundaries and the mid-point used to weight them, from the workbook. */
const AGE_BUCKETS = [
  { hi: 30, mid: 15 },
  { hi: 60, mid: 45 },
  { hi: 90, mid: 75 },
  { hi: 180, mid: 135 },
  { hi: 365, mid: 272.5 },
  { hi: Infinity, mid: 365 },
];

/**
 * The scorecard rows, in the order the workbook lists them. `apportKey` is the
 * key `buildApportionment` uses for the vertical's cost (AIF and GIFT share
 * Raja's pool column). `codes` is every ledger code that rolls into the row -
 * "Raja - AIF & GIFT" is one row across both companies, as in the workbook.
 */
const ROWS: { code: string; label: string; codes: string[]; apportKey: string | null }[] = [
  { code: "DLR", label: "Vijay - DLR", codes: ["DLR"], apportKey: "DLR" },
  { code: "CMRGA", label: "Gayathri - CMRGA", codes: ["CMRGA"], apportKey: "CMRGA" },
  { code: "CFC", label: "Rekha - CFC", codes: ["CFC"], apportKey: "CFC" },
  { code: "RRG", label: "Dharshan - RRG", codes: ["RRG"], apportKey: "RRG" },
  { code: "ECM", label: "Vasudharini - ECM", codes: ["ECM"], apportKey: "ECM" },
  { code: "GADD", label: "Ekta - GADD", codes: ["GADD"], apportKey: "GADD" },
  { code: "ACC", label: "Meenakshi - ACC", codes: ["ACC"], apportKey: "ACC" },
  { code: "COMMON", label: "Common incl PC", codes: ["COMMON"], apportKey: "COMMON" },
  { code: "AIF_GIFT", label: "Raja - AIF & GIFT", codes: ["AIF", "GIFT"], apportKey: "GIFT" },
  { code: "JIPO", label: "Jayanth - IPO", codes: ["JIPO"], apportKey: null },
  { code: "HRCM", label: "Mahalakshmi - HRCM", codes: ["HRCM"], apportKey: "HRCM" },
];

export interface ScorecardRow {
  code: string;
  label: string;
  revenueBudget: number;
  revenueActual: number;
  revenueAchievement: number | null;
  collectionBudget: number;
  collectionActual: number;
  collectionAchievement: number | null;
  cost: number;
  revenueContribution: number;
  revenueContributionShare: number | null;
  collectionContribution: number;
  collectionContributionShare: number | null;
  ageingBuckets: number[];
  ageingTotal: number;
  ageingDays: number | null;
  ratings: {
    revenue: number;
    collection: number;
    netRevContrib: number;
    netCollContrib: number;
    ageing: number | null;
    mgmt: number;
  };
  composite: number;
}

export interface ScorecardResult {
  quarter: QuarterNo;
  cumulative: boolean;
  window: { start: string; end: string; months: number; label: string };
  arAsOf: string | null;
  rows: ScorecardRow[];
}

const QUARTER_LABELS = ["Q1 · Apr–Jun", "Q2 · Jul–Sep", "Q3 · Oct–Dec", "Q4 · Jan–Mar"];
const QUARTER_END_MONTH = ["Jun", "Sep", "Dec", "Mar"];

export async function buildScorecard(opts: {
  entity: Entity;
  fyStartYear: number;
  quarter: QuarterNo;
  cumulative: boolean;
}): Promise<ScorecardResult> {
  const { entity, fyStartYear, quarter, cumulative } = opts;

  const months = fyMonths(fyStartYear).filter((m) =>
    cumulative ? m.quarter <= quarter : m.quarter === quarter,
  );
  const start = months[0].start;
  const end = months[months.length - 1].end;
  const fraction = months.length / 12;
  const window = {
    start,
    end,
    months: months.length,
    label:
      cumulative && quarter > 1
        ? `Apr–${QUARTER_END_MONTH[quarter - 1]}`
        : QUARTER_LABELS[quarter - 1],
  };

  const quartersInRange = (cumulative ? [1, 2, 3, 4].filter((q) => q <= quarter) : [quarter]) as QuarterNo[];

  const [revenueBva, collectionBva, apportionments, ageingRows] = await Promise.all([
    buildBudgetVsActual({
      entity,
      fyStartYear,
      measure: "revenue",
      period: { start, end, fraction, monthAligned: true },
    }),
    buildBudgetVsActual({
      entity,
      fyStartYear,
      measure: "collection",
      period: { start, end, fraction, monthAligned: true },
    }),
    Promise.all(
      quartersInRange.map((q) => buildApportionment({ entity, fyStartYear, quarter: q })),
    ),
    query<{
      code: string | null;
      as_of: string;
      b0: number; b1: number; b2: number; b3: number; b4: number; b5: number;
    }>(
      `with snap as (
         -- the AR snapshot closest to the window end; if none was taken by
         -- then (a back-quarter with no contemporaneous export), the earliest
         -- one available is the best proxy.
         select coalesce(
           (select max(as_of) from ar_open_items where entity_id = any($1::int[]) and as_of <= $2),
           (select min(as_of) from ar_open_items where entity_id = any($1::int[]))
         ) as as_of
       )
       select v.code,
              (select as_of from snap) as as_of,
              coalesce(sum(a.balance_base) filter (where age <= 30), 0) as b0,
              coalesce(sum(a.balance_base) filter (where age between 31 and 60), 0) as b1,
              coalesce(sum(a.balance_base) filter (where age between 61 and 90), 0) as b2,
              coalesce(sum(a.balance_base) filter (where age between 91 and 180), 0) as b3,
              coalesce(sum(a.balance_base) filter (where age between 181 and 365), 0) as b4,
              coalesce(sum(a.balance_base) filter (where age > 365), 0) as b5
         from (
           select ar.*, (ar.as_of - coalesce(ar.due_date, ar.invoice_date)) as age
             from ar_open_items ar
            where ar.entity_id = any($1::int[]) and ar.as_of = (select as_of from snap)
         ) a
         left join verticals v on v.id = a.vertical_id
        group by v.code`,
      [entity.memberIds, end],
    ),
  ]);

  // ----- fold apportionment across the quarters in range, keyed by receiver -----
  const apport = new Map<string, { revenue: number; cost: number; contribution: number }>();
  for (const ap of apportionments) {
    for (const v of ap.verticals) {
      const cur = apport.get(v.key) ?? { revenue: 0, cost: 0, contribution: 0 };
      cur.revenue += v.revenue;
      cur.cost += v.totalCost;
      cur.contribution += v.contribution;
      apport.set(v.key, cur);
    }
  }

  const revByCode = new Map(revenueBva.rows.map((r) => [r.code ?? "", r]));
  const collByCode = new Map(collectionBva.rows.map((r) => [r.code ?? "", r]));
  const ageByCode = new Map(ageingRows.map((r) => [r.code ?? "", r]));
  const arAsOf = ageingRows[0]?.as_of ?? null;

  // ----- assemble rows, then the shares (need the totals first) -----
  type Draft = ScorecardRow & { _hasData: boolean };
  const drafts: Draft[] = ROWS.map((def) => {
    const rev = def.codes.reduce((s, c) => s + (revByCode.get(c)?.period.actual ?? 0), 0);
    const revBud = def.codes.reduce((s, c) => s + (revByCode.get(c)?.period.periodBudget ?? 0), 0);
    const coll = def.codes.reduce((s, c) => s + (collByCode.get(c)?.period.actual ?? 0), 0);
    const collBud = def.codes.reduce((s, c) => s + (collByCode.get(c)?.period.periodBudget ?? 0), 0);

    // Cost = the vertical's direct + apportioned-common cost, from the
    // apportionment engine. A vertical it does not model (JIPO) carries no
    // apportioned cost here, so its contribution is revenue less nil.
    const ap = def.apportKey ? apport.get(def.apportKey) : undefined;
    const cost = ap?.cost ?? 0;
    const revContribution = ap?.contribution ?? rev - cost;
    const collContribution = coll - cost;

    // AIF_GIFT sums its two codes' buckets elementwise; everything else is one code.
    const buckets = [0, 1, 2, 3, 4, 5].map((i) =>
      def.codes.reduce((s, c) => {
        const row = ageByCode.get(c) as Record<string, number> | undefined;
        return s + (row ? Number(row[`b${i}`] ?? 0) : 0);
      }, 0),
    );
    const ageingTotal = buckets.reduce((s, b) => s + b, 0);
    const hasAr = def.codes.some((c) => ageByCode.has(c));
    const ageingDays = !hasAr
      ? null
      : ageingTotal === 0
        ? 0
        : buckets.reduce((s, b, i) => s + b * AGE_BUCKETS[i].mid, 0) / ageingTotal;

    // On the scorecard only if the vertical is budgeted, traded, or carries a
    // receivable this period. A zero apportionment row (every RECEIVER exists
    // for every entity) is not, on its own, activity.
    const hasData =
      revBud > 0 || collBud > 0 || rev !== 0 || coll !== 0 || ageingTotal !== 0;

    return {
      code: def.code,
      label: def.label,
      revenueBudget: revBud,
      revenueActual: rev,
      revenueAchievement: revBud > 0 ? rev / revBud : null,
      collectionBudget: collBud,
      collectionActual: coll,
      collectionAchievement: collBud > 0 ? coll / collBud : null,
      cost,
      revenueContribution: revContribution,
      revenueContributionShare: null,
      collectionContribution: collContribution,
      collectionContributionShare: null,
      ageingBuckets: buckets,
      ageingTotal,
      ageingDays,
      ratings: {
        revenue: 0,
        collection: 0,
        netRevContrib: 0,
        netCollContrib: 0,
        ageing: null,
        mgmt: MGMT_APPRAISAL_DEFAULT,
      },
      composite: 0,
      _hasData: hasData,
    };
  });

  const totalRevContribution = drafts.reduce((s, d) => s + Math.max(0, d.revenueContribution), 0);
  const totalCollContribution = drafts.reduce((s, d) => s + Math.max(0, d.collectionContribution), 0);

  const rows: ScorecardRow[] = drafts
    .filter((d) => d._hasData)
    .map((d) => {
      const revShare = totalRevContribution > 0 ? d.revenueContribution / totalRevContribution : null;
      const collShare = totalCollContribution > 0 ? d.collectionContribution / totalCollContribution : null;
      const ageingRating = d.ageingDays === null ? null : rateAgeingDays(d.ageingDays);
      const ratings = {
        revenue: rateBudgetAchievement(d.revenueAchievement),
        collection: rateBudgetAchievement(d.collectionAchievement),
        netRevContrib: rateContributionShare(revShare),
        netCollContrib: rateContributionShare(collShare),
        ageing: ageingRating,
        mgmt: MGMT_APPRAISAL_DEFAULT,
      };
      const composite =
        WEIGHTS.revenue * ratings.revenue +
        WEIGHTS.collection * ratings.collection +
        WEIGHTS.netRevContrib * ratings.netRevContrib +
        WEIGHTS.netCollContrib * ratings.netCollContrib +
        WEIGHTS.ageing * (ratings.ageing ?? 0) +
        WEIGHTS.mgmt * ratings.mgmt;
      const { _hasData, ...rest } = d;
      void _hasData;
      return {
        ...rest,
        revenueContributionShare: revShare,
        collectionContributionShare: collShare,
        ratings,
        composite,
      };
    });

  return { quarter, cumulative, window, arAsOf, rows };
}

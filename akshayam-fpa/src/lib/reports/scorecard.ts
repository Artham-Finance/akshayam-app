import { query } from "@/lib/db";
import { getVerticals, listAllEntities, type Entity } from "@/lib/entity";
import { fyMonths, type QuarterNo } from "@/lib/period";
import { buildBudgetVsActual } from "@/lib/reports/budget";
import { scorecardBudgetFor, scorecardBudgetSource } from "@/lib/reports/scorecard-budget";
import { buildProfitAndLoss } from "@/lib/reports/statements";
import { buildVerticalCostApportionment } from "@/lib/reports/vertical-cost-apportionment";
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
 * column the P&L's cost apportionment card uses for the vertical - the six it
 * spreads Common's and ACC and HRCM's cost over on head count; the scorecard
 * reads cost off that same engine so the two always agree. `ownCost` marks a
 * row outside the six that is charged its own directly-tagged cost and no
 * share of the pool (Raja). Common, ACC and HRCM carry none: their cost is the
 * pool. `codes` is every ledger code that rolls into the row - "Raja - AIF &
 * GIFT" is one row across both companies, as in the workbook.
 */
export const ROWS: {
  code: string;
  label: string;
  codes: string[];
  apportKey: string | null;
  ownCost?: boolean;
  /** where the revised budget is held, when this row is one half of a shared one (Raja's AIF or GIFT) */
  budgetCode?: string;
  budgetCompanies?: string[];
}[] = [
  { code: "DLR", label: "Vijay - DLR", codes: ["DLR"], apportKey: "DLR" },
  { code: "CMRGA", label: "Gayathri - CMRGA", codes: ["CMRGA"], apportKey: "CMRGA" },
  { code: "CFC", label: "Rekha - CFC", codes: ["CFC"], apportKey: "CFC" },
  { code: "RRG", label: "Dharshan - RRG", codes: ["RRG"], apportKey: "RRG" },
  { code: "ECM", label: "Vasudharini - ECM", codes: ["ECM"], apportKey: "ECM" },
  { code: "GADD", label: "Ekta - GADD", codes: ["GADD"], apportKey: "GADD" },
  { code: "ACC", label: "Meenakshi - ACC", codes: ["ACC"], apportKey: null },
  { code: "COMMON", label: "Common incl partners contribution", codes: ["COMMON"], apportKey: null },
  { code: "AIF_GIFT", label: "Raja - AIF & GIFT", codes: ["AIF", "GIFT"], apportKey: null, ownCost: true },
  { code: "JIPO", label: "Jayanth - IPO", codes: ["JIPO"], apportKey: null },
  { code: "HRCM", label: "Mahalakshmi - HRCM", codes: ["HRCM"], apportKey: null },
];

/**
 * The rows as one scope reads them. Raja's row is AIF (RBJV) and GIFT (Akshayam):
 * on RBJV's own scorecard it is AIF alone - GIFT is Akshayam's, and a stray GIFT
 * tag in RBJV's books is not Raja's - and on Akshayam's it is GIFT alone. A view
 * across both companies (the group, or Raja's own login) carries the two as rows of
 * their own, "Raja - AIF" and "Raja - GIFT", each on its own company's budget.
 */
export function scorecardRowsFor(companySlugs: string[]): typeof ROWS {
  const rbjv = companySlugs.includes("rbjv");
  const akshayam = companySlugs.includes("akshayam");
  return ROWS.flatMap((r) => {
    if (r.code !== "AIF_GIFT") return [r];
    if (rbjv && !akshayam) return [{ ...r, label: "Raja - AIF", codes: ["AIF"], apportKey: "AIF", ownCost: false }];
    if (akshayam && !rbjv) return [{ ...r, label: "Raja - GIFT", codes: ["GIFT"] }];
    return [
      { ...r, code: "AIF", label: "Raja - AIF", codes: ["AIF"], apportKey: "AIF", ownCost: false, budgetCode: "AIF_GIFT", budgetCompanies: ["rbjv"] },
      { ...r, code: "GIFT", label: "Raja - GIFT", codes: ["GIFT"], budgetCode: "AIF_GIFT", budgetCompanies: ["akshayam"] },
    ];
  });
}

/** The company slugs an entity reports on - what `scorecardRowsFor` reads. */
export async function scorecardCompanySlugs(entity: Entity): Promise<string[]> {
  return (
    await query<{ slug: string }>("select slug from entities where id = any($1::int[])", [entity.memberIds])
  ).map((r) => r.slug);
}

/**
 * The scorecard row a ledger vertical code rolls into, or null for one the
 * scorecard does not track. AIF and GIFT share Raja's row, so this is the
 * mapping a caller narrowing the card to a slice's verticals needs.
 */
export function scorecardRowCodeFor(verticalCode: string): string | null {
  return ROWS.find((r) => r.codes.includes(verticalCode))?.code ?? null;
}

export interface ScorecardScope {
  /** the current entity is a single-vertical slice - a team lead's own book */
  isSlice: boolean;
  /**
   * The company (or the group) the scorecard is struck across. A slice's own
   * figures cannot carry the contribution shares and firm totals, so those are
   * always computed on the whole book the slice is cut from.
   */
  benchmark: Entity;
  /** scorecard row codes this viewer may see, or null for every row */
  visibleCodes: Set<string> | null;
}

/**
 * Who sees which rows of the scorecard.
 *
 * A whole-company (or group) entity sees everything. A slice - a team lead
 * granted only their own vertical - sees the scorecard struck across the
 * company it belongs to, narrowed to their own row(s).
 */
export async function resolveScorecardScope(entity: Entity): Promise<ScorecardScope> {
  if (entity.verticalIds === null) {
    return { isSlice: false, benchmark: entity, visibleCodes: null };
  }
  const all = await listAllEntities();
  const sameCompanies = (e: Entity) =>
    !e.verticalIds &&
    [...e.memberIds].sort().join(",") === [...entity.memberIds].sort().join(",");
  const benchmark =
    all.find(sameCompanies) ?? all.find((e) => e.slug === "group") ?? entity;
  const sliceVerticals = await getVerticals(entity);
  const visibleCodes = new Set(
    sliceVerticals
      .map((v) => scorecardRowCodeFor(v.code))
      .filter((c): c is string => c !== null),
  );
  // Raja's row is AIF and GIFT together, or each on its own where the scorecard splits them
  if (visibleCodes.has("AIF_GIFT")) {
    visibleCodes.add("AIF");
    visibleCodes.add("GIFT");
  }
  return { isSlice: true, benchmark, visibleCodes };
}

export interface ScorecardRow {
  code: string;
  label: string;
  revenueBudget: number;
  revenueActual: number;
  revenueAchievement: number | null;
  collectionBudget: number;
  collectionActual: number;
  collectionAchievement: number | null;
  /** the vertical's own directly-tagged cost */
  directCost: number;
  /** its share of the apportioned common pool */
  apportionedCost: number;
  /** Finance cost (interest and bank charges) booked to the vertical, carried on its own row. */
  financeCost: number;
  /**
   * Out-of-books billing on the vertical: rated against budget in the revenue
   * card, and added to its net revenue contribution here, so the contribution
   * ties to the P&L, which carries it as revenue.
   */
  osbRevenue: number;
  /**
   * directCost + apportionedCost + financeCost - the figure contribution is struck on.
   * Common's `directCost` also carries what is booked to no vertical at all - the
   * net reimbursable cost (RE less RI) and any untagged posting - so that the whole
   * of the P&L is on the card.
   */
  cost: number;
  /**
   * Ledger revenue for the vertical - what net revenue contribution is struck
   * on. Differs from `revenueActual` when the vertical bills outside the books:
   * that out-of-books revenue counts towards the budget rating but has no cost
   * line beneath it, so the contribution card leaves it out and stays
   * arithmetically clean (revenue - direct - apportioned = contribution).
   */
  contributionRevenue: number;
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

/**
 * Actual revenue and collection on a line the scorecard does not rate - DSC and
 * support, and what is booked to no vertical. Shown at the foot of the revenue and
 * collection cards with no budget and no rating, so the totals are the Overview's.
 */
export interface UnratedLine {
  code: string;
  label: string;
  revenueActual: number;
  collectionActual: number;
  /** collection less the finance cost booked to it - struck like a vertical's net collection contribution */
  collectionContribution: number;
  collectionContributionShare: number | null;
  /** its open receivables by age, the same six buckets as a rated row's */
  ageingBuckets: number[];
  ageingTotal: number;
  ageingDays: number | null;
}

export interface ScorecardResult {
  quarter: QuarterNo;
  cumulative: boolean;
  window: { start: string; end: string; months: number; label: string };
  arAsOf: string | null;
  /**
   * Where the budgets rated against come from: the revised quarterly budget
   * (named, for the note on the page), or null when the usual annual budgets
   * were read.
   */
  revisedBudgetSource: string | null;
  rows: ScorecardRow[];
  /** actual revenue and collection on lines that are not rated, so the totals match the Overview */
  unrated: UnratedLine[];
  /**
   * DSC and support, shown in the contribution cards only: its revenue is part of
   * the P&L's, its cost is already in Common's pool, and it is not rated. Null
   * where there is none (Akshayam, a team lead's slice).
   */
  dsc: ScorecardRow | null;
  /**
   * The P&L's profit before tax (EBITDA less finance cost) less the contribution
   * of every row, DSC included. Nil when the card ties to the P&L, as it should;
   * the Data checks page says so when it does not.
   */
  unreconciled: number;
}

const QUARTER_LABELS = ["Q1 · Apr–Jun", "Q2 · Jul–Sep", "Q3 · Oct–Dec", "Q4 · Jan–Mar"];
const QUARTER_END_MONTH = ["Jun", "Sep", "Dec", "Mar"];

export async function buildScorecard(opts: {
  entity: Entity;
  fyStartYear: number;
  quarter: QuarterNo;
  cumulative: boolean;
  /**
   * One month inside the quarter, to narrow the window to it - the
   * scorecard's own version of "expand to months".
   *
   * Overrides cumulative rather than combining with it: a month picked while
   * "cumulative to quarter" was selected still means "just this month", not
   * a mix of whole earlier quarters and one month of the current one, which
   * would read like a figure nobody actually asked for.
   */
  month?: string | null;
}): Promise<ScorecardResult> {
  const { entity, fyStartYear, quarter, cumulative, month = null } = opts;

  const allMonths = fyMonths(fyStartYear);
  const pickedMonth = month ? (allMonths.find((m) => m.key === month) ?? null) : null;
  const months = pickedMonth
    ? [pickedMonth]
    : allMonths.filter((m) => (cumulative ? m.quarter <= quarter : m.quarter === quarter));
  const start = months[0].start;
  const end = months[months.length - 1].end;
  const fraction = months.length / 12;
  const window = {
    start,
    end,
    months: months.length,
    label:
      pickedMonth?.label ??
      (cumulative && quarter > 1
        ? `Apr–${QUARTER_END_MONTH[quarter - 1]}`
        : QUARTER_LABELS[quarter - 1]),
  };

  const quartersInRange = (
    pickedMonth ? [pickedMonth.quarter] : cumulative ? [1, 2, 3, 4].filter((q) => q <= quarter) : [quarter]
  ) as QuarterNo[];

  // The companies in scope, by slug - the revised budget is held per company.
  const companySlugs = await scorecardCompanySlugs(entity);
  const rowDefs = scorecardRowsFor(companySlugs);

  // Finance cost by vertical code over the window - each vertical's row carries its own.
  const financeByCode = new Map(
    (
      await query<{ code: string | null; amount: number }>(
        `select v.code, sum(g.debit - g.credit)::numeric as amount
           from gl_entries g
           join accounts a on a.id = g.account_id
           left join verticals v on v.id = g.vertical_id
          where g.entity_id = any($1::int[]) and g.txn_date between $2 and $3
            and a.statement = 'pnl' and a.group_code = 'finance_cost'
          group by v.code`,
        [entity.memberIds, start, end],
      )
    ).map((r) => [r.code ?? "", Number(r.amount)]),
  );

  /*
    The net reimbursable cost (RE less RI) of the window. The apportionment card
    leaves it out, so no vertical's cost carries it; here it is put on Common's row,
    as Common's direct cost, so the whole of the P&L's figure is on the card. Where
    there is no Common (Akshayam alone), Raja's GIFT row bears it.
  */
  const reimbursementsNet = Number(
    (
      await query<{ amount: number }>(
        `select coalesce(sum(g.debit - g.credit), 0)::numeric as amount
           from gl_entries g
           join accounts a on a.id = g.account_id
          where g.entity_id = any($1::int[]) and g.txn_date between $2 and $3
            and a.statement = 'pnl' and a.group_code = 'reimbursements'
            and not ($4::boolean and a.is_intercompany)`,
        [entity.memberIds, start, end, entity.consolidates],
      )
    )[0]?.amount ?? 0,
  );
  /*
    Anything booked to no vertical at all - revenue, cost, other income, finance
    cost, out-of-books items - has no row of its own to sit on. It is dropped into
    Common's direct cost (revenue as a negative cost), with the RE / RI above, so
    the card's total is the P&L's.
  */
  const untagged = (
    await query<{ revenue: number; cost: number }>(
      `select coalesce(sum(case when a.group_code = 'revenue' then g.credit - g.debit else 0 end), 0)::numeric as revenue,
              coalesce(sum(case when a.group_code in ('direct_cost','establishment_cost','overheads','other_income','finance_cost')
                                then g.debit - g.credit else 0 end), 0)::numeric as cost
         from gl_entries g
         join accounts a on a.id = g.account_id
        where g.entity_id = any($1::int[]) and g.txn_date between $2 and $3
          and a.statement = 'pnl' and g.vertical_id is null
          and not ($4::boolean and a.is_intercompany)`,
      [entity.memberIds, start, end, entity.consolidates],
    )
  )[0];
  const untaggedOsb = (
    await query<{ revenue: number; cost: number }>(
      `select (select coalesce(sum(i.amount_base), 0) from invoice_lines i
                 where i.entity_id = any($1::int[]) and i.is_osb and i.vertical_id is null
                   and i.invoice_date between $2 and $3)::numeric as revenue,
              (select coalesce(sum(o.amount), 0) from osb_expense_entries o
                where o.entity_id = any($1::int[]) and o.vertical_id is null
                  and o.month between date_trunc('month', $2::date)::date and $3::date)::numeric as cost`,
      [entity.memberIds, start, end],
    )
  )[0];
  const untaggedNetCost =
    Number(untagged?.cost ?? 0) + Number(untaggedOsb?.cost ?? 0) - Number(untagged?.revenue ?? 0) - Number(untaggedOsb?.revenue ?? 0);
  const commonCarries = reimbursementsNet + untaggedNetCost;
  const commonRow = companySlugs.includes("rbjv") ? "COMMON" : "AIF_GIFT";

  // Out-of-books billing by vertical code over the window.
  const osbByCode = new Map(
    (
      await query<{ code: string | null; amount: number }>(
        `select v.code, sum(i.amount_base)::numeric as amount
           from invoice_lines i
           left join verticals v on v.id = i.vertical_id
          where i.entity_id = any($1::int[]) and i.is_osb and i.invoice_date between $2 and $3
          group by v.code`,
        [entity.memberIds, start, end],
      )
    ).map((r) => [r.code ?? "", Number(r.amount)]),
  );

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
      quartersInRange.map((q) =>
        buildVerticalCostApportionment({
          entity,
          fyStartYear,
          quarter: q,
          month: pickedMonth?.key ?? null,
        }),
      ),
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
  const apport = new Map<
    string,
    { revenue: number; cost: number; directCost: number; apportionedCost: number; contribution: number }
  >();
  // The verticals outside the six, by ledger code, folded the same way.
  const outside = new Map<string, { revenue: number; directCost: number }>();
  for (const ap of apportionments) {
    for (const v of ap.verticals) {
      const cur =
        apport.get(v.key) ??
        { revenue: 0, cost: 0, directCost: 0, apportionedCost: 0, contribution: 0 };
      cur.revenue += v.revenue;
      cur.cost += v.totalCost;
      cur.directCost += v.directTeamCost + v.directOverheads + v.otherIncome;
      cur.apportionedCost += v.commonApportioned + v.accHrcmApportioned;
      cur.contribution += v.contribution;
      apport.set(v.key, cur);
    }
    for (const [code, o] of Object.entries(ap.outside)) {
      const cur = outside.get(code) ?? { revenue: 0, directCost: 0 };
      cur.revenue += o.revenue;
      cur.directCost += o.directCost;
      outside.set(code, cur);
    }
  }

  const revByCode = new Map(revenueBva.rows.map((r) => [r.code ?? "", r]));
  const collByCode = new Map(collectionBva.rows.map((r) => [r.code ?? "", r]));
  const ageByCode = new Map(ageingRows.map((r) => [r.code ?? "", r]));
  const arAsOf = ageingRows[0]?.as_of ?? null;

  // ----- assemble rows, then the shares (need the totals first) -----
  type Draft = ScorecardRow & { _hasData: boolean };
  const drafts: Draft[] = rowDefs.map((def) => {
    const rev = def.codes.reduce((s, c) => s + (revByCode.get(c)?.period.actual ?? 0), 0);
    // The revised quarterly budget, where there is one for the year - for this
    // scorecard only; every other report keeps the budgets already loaded.
    const revised = scorecardBudgetFor(fyStartYear, def.budgetCompanies ?? companySlugs, def.budgetCode ?? def.code, months);
    const revBud =
      revised?.revenue ??
      def.codes.reduce((s, c) => s + (revByCode.get(c)?.period.periodBudget ?? 0), 0);
    const coll = def.codes.reduce((s, c) => s + (collByCode.get(c)?.period.actual ?? 0), 0);
    const collBud =
      revised?.collection ??
      def.codes.reduce((s, c) => s + (collByCode.get(c)?.period.periodBudget ?? 0), 0);

    // Cost = the vertical's direct + apportioned cost, from the same engine as
    // the P&L's cost apportionment card. One of the six reads its row there;
    // Raja is charged his own directly-tagged cost and no share of the pool;
    // Common, ACC, HRCM (whose cost is the pool) and JIPO (which the engine
    // does not model) carry none, so their contribution is revenue less nil.
    const ap = def.apportKey ? apport.get(def.apportKey) : undefined;
    const own = def.ownCost
      ? def.codes.reduce(
          (s, c) => ({
            revenue: s.revenue + (outside.get(c)?.revenue ?? 0),
            directCost: s.directCost + (outside.get(c)?.directCost ?? 0),
          }),
          { revenue: 0, directCost: 0 },
        )
      : undefined;
    const financeCost = def.codes.reduce((s, c) => s + (financeByCode.get(c) ?? 0), 0);
    const carried = def.code === commonRow ? commonCarries : 0;
    const osbRevenue = def.codes.reduce((s, c) => s + (osbByCode.get(c) ?? 0), 0);
    const directCost = (ap?.directCost ?? own?.directCost ?? 0) + carried;
    const apportionedCost = ap?.apportionedCost ?? 0;
    // what the vertical's cost was before finance cost and RE / RI are put on it
    const baseCost = ap?.cost ?? own?.directCost ?? 0;
    const cost = baseCost + financeCost + carried;
    // Ledger revenue is what the cost beneath it is struck against; out-of-books
    // billing is added alongside it (its own column) so the contribution is the
    // P&L's. A vertical with no ledger activity at all falls back to the budget figure.
    const ledgerRevenue = def.codes.some((c) => outside.has(c))
      ? def.codes.reduce((s, c) => s + (outside.get(c)?.revenue ?? 0), 0)
      : rev;
    const contributionRevenue = ap?.revenue ?? ledgerRevenue;
    const revContribution =
      (ap?.contribution ?? contributionRevenue - baseCost) + osbRevenue - financeCost - carried;
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
      directCost,
      apportionedCost,
      financeCost,
      osbRevenue,
      cost,
      contributionRevenue,
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

  // Lines the rows above do not carry - DSC and support, what is booked to no vertical:
  // not rated, but in the Overview's totals for revenue, collection and receivables.
  const coveredCodes = new Set(rowDefs.flatMap((d) => d.codes));
  const unratedKeys = new Set(
    [...revByCode.keys(), ...collByCode.keys(), ...ageByCode.keys()].filter((c) => !coveredCodes.has(c)),
  );
  const unratedBase = [...unratedKeys]
    .map((code) => {
      const buckets = [0, 1, 2, 3, 4, 5].map((i) =>
        Number(((ageByCode.get(code) as Record<string, number> | undefined) ?? {})[`b${i}`] ?? 0),
      );
      const ageingTotal = buckets.reduce((t, b) => t + b, 0);
      const collection = collByCode.get(code)?.period.actual ?? 0;
      // finance cost booked to no vertical is on Common's direct cost already, so not here again
      const finance = code === "" ? 0 : (financeByCode.get(code) ?? 0);
      return {
        code: code || "UNATTRIBUTED",
        label:
          revByCode.get(code)?.name ??
          collByCode.get(code)?.name ??
          (code === "DSC" ? "DSC and support" : code || "Not attributed to a vertical"),
        revenueActual: revByCode.get(code)?.period.actual ?? 0,
        collectionActual: collection,
        collectionContribution: collection - finance,
        collectionContributionShare: null as number | null,
        ageingBuckets: buckets,
        ageingTotal,
        ageingDays:
          ageingTotal === 0 ? null : buckets.reduce((t, b, i) => t + b * AGE_BUCKETS[i].mid, 0) / ageingTotal,
      };
    })
    .filter(
      (u) =>
        Math.abs(u.revenueActual) >= 0.5 || Math.abs(u.collectionActual) >= 0.5 || Math.abs(u.ageingTotal) >= 0.5,
    )
    // DSC and support first, then whatever else is on no row
    .sort((a, b) => (a.code === "DSC" ? -1 : b.code === "DSC" ? 1 : 0));
  const dscCollection = unratedBase.find((u) => u.code === "DSC")?.collectionActual ?? 0;

  // DSC and support: not a rated vertical, but its revenue is in the P&L, so it is a
  // line of the contribution cards (its cost is already in Common's pool).
  const dscRevenue = outside.get("DSC")?.revenue ?? 0;
  const dscOsb = osbByCode.get("DSC") ?? 0;
  const dscFinance = financeByCode.get("DSC") ?? 0;
  const dscContribution = dscRevenue + dscOsb - dscFinance;
  const dscDraft: ScorecardRow | null =
    companySlugs.includes("rbjv") && (dscRevenue !== 0 || dscOsb !== 0 || dscFinance !== 0 || dscCollection !== 0)
      ? {
          code: "DSC",
          label: "DSC and support",
          revenueBudget: 0,
          revenueActual: dscRevenue + dscOsb,
          revenueAchievement: null,
          collectionBudget: 0,
          collectionActual: dscCollection,
          collectionAchievement: null,
          directCost: 0,
          apportionedCost: 0,
          financeCost: dscFinance,
          osbRevenue: dscOsb,
          cost: dscFinance,
          contributionRevenue: dscRevenue,
          revenueContribution: dscContribution,
          revenueContributionShare: null,
          collectionContribution: dscCollection - dscFinance,
          collectionContributionShare: null,
          ageingBuckets: [0, 0, 0, 0, 0, 0],
          ageingTotal: 0,
          ageingDays: null,
          ratings: { revenue: 0, collection: 0, netRevContrib: 0, netCollContrib: 0, ageing: null, mgmt: MGMT_APPRAISAL_DEFAULT },
          composite: 0,
        }
      : null;

  const totalRevContribution =
    drafts.reduce((s, d) => s + Math.max(0, d.revenueContribution), 0) + Math.max(0, dscDraft?.revenueContribution ?? 0);
  const totalCollContribution =
    drafts.reduce((s, d) => s + Math.max(0, d.collectionContribution), 0) +
    unratedBase.reduce((s, u) => s + Math.max(0, u.collectionContribution), 0);

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

  const unrated: UnratedLine[] = unratedBase.map((u) => ({
    ...u,
    collectionContributionShare: totalCollContribution > 0 ? u.collectionContribution / totalCollContribution : null,
  }));

  const dsc: ScorecardRow | null = dscDraft
    ? {
        ...dscDraft,
        revenueContributionShare:
          totalRevContribution > 0 ? dscDraft.revenueContribution / totalRevContribution : null,
        collectionContributionShare:
          totalCollContribution > 0 ? dscDraft.collectionContribution / totalCollContribution : null,
      }
    : null;

  // The tie to the P&L: its profit before tax (EBITDA less finance cost) over the same
  // months, against every row's contribution. It is nil when nothing is missing.
  const pl = await buildProfitAndLoss({ entity, fyStartYear, verticalId: null, window: { start, end } });
  const plTotal = (groupCode: string) => {
    const line = pl.lines.find((l) => l.level === 0 && l.groupCode === groupCode);
    return line ? months.reduce((s, m) => s + (line.values[m.key] ?? 0), 0) : 0;
  };
  const unreconciled =
    plTotal("ebitda") +
    plTotal("finance_cost") -
    (rows.reduce((s, r) => s + r.revenueContribution, 0) + (dsc?.revenueContribution ?? 0));

  return {
    quarter,
    cumulative,
    window,
    arAsOf,
    revisedBudgetSource: scorecardBudgetSource(fyStartYear),
    rows,
    unrated,
    dsc,
    unreconciled,
  };
}

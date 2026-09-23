import { query } from "@/lib/db";
import type { Entity } from "@/lib/entity";
import { fyMonths, type QuarterNo } from "@/lib/period";

/**
 * Vertical-wise P&L after cost apportionment, for VPP.
 *
 * A narrower, simpler cousin of `buildApportionment` (which the Vertical
 * Performance Scorecard still uses, unchanged, across all nine verticals and
 * the budget's own multi-basis rules). This one is struck for exactly six
 * verticals, on one rule only - head count - over two pools: actual cost
 * booked under "Common incl partners contribution", and actual cost booked
 * under ACC and HRCM (both their direct team cost and their overheads,
 * combined into one pool). A cost already tagged to one of the six is that
 * vertical's own and is never re-spread; cost under any other vertical
 * (GIFT/AIF, DSC) or left untagged is outside this card's arrangement
 * entirely, not shown and not pooled. ACC's and HRCM's own revenue plays no
 * part here either - only their cost is spread, the same as Common's.
 *
 * `wide` alongside carries the same two pools spread on the same head-count
 * rule but over the company's whole head count instead - a comparison, not
 * this card's own figures. That denominator is kept in `company_headcount`,
 * keyed in directly for exactly the reason a sum of vertical_headcount is
 * not good enough: it silently misses anyone in Common, DSC, or another
 * vertical that never had its own monthly figure. Where nothing has been
 * keyed in yet, that sum is used as a fallback so the comparison card is
 * never simply empty, and `companyHeadsIsKeyed` says which is showing.
 */

const RECEIVERS: { key: string; label: string; code: string }[] = [
  { key: "ECM", label: "Vasudharini — ECM", code: "ECM" },
  { key: "GADD", label: "Ekta — GADD", code: "GADD" },
  { key: "CMRGA", label: "Gayathri — CMRGA", code: "CMRGA" },
  { key: "DLR", label: "Vijay — DLR", code: "DLR" },
  { key: "RRG", label: "Dharshan — RRG", code: "RRG" },
  { key: "CFC", label: "Rekha — CFC", code: "CFC" },
];

/** The apportionment column a ledger vertical belongs to, or null - only the six take part. */
export function costApportionmentKeyFor(code: string | null | undefined): string | null {
  if (!code) return null;
  return RECEIVERS.find((r) => r.code === code)?.key ?? null;
}

export interface CostAccountLine {
  /** the ledger account name this row is struck on */
  account: string;
  /** amount by vertical key - a direct line's own tagged cost, or the common line's head-count share */
  amountByKey: Record<string, number>;
  /** the line's total across the six - the pooled amount, for a common-cost line */
  total: number;
}

export interface ApportionedVerticalCost {
  key: string;
  label: string;
  /** the ledger vertical this column edits its head count against */
  verticalId: number | null;
  /** average head count over the window; a whole number when a single month is shown */
  heads: number;
  revenue: number;
  directTeamCost: number;
  directOverheads: number;
  commonApportioned: number;
  /** ACC's and HRCM's own direct team cost and overheads, combined into one pool and spread the same way as Common's */
  accHrcmApportioned: number;
  totalCost: number;
  /** revenue less every cost, direct and apportioned - the figure VPP is struck on */
  contribution: number;
  /** Common's pool, spread instead over every head in the entity - the comparison denominator */
  commonApportionedWide: number;
  /** ACC's and HRCM's pool, spread instead over every head in the entity - the comparison denominator */
  accHrcmApportionedWide: number;
  totalCostWide: number;
  contributionWide: number;
}

export interface VerticalCostApportionmentResult {
  /** false where there is nothing to apportion, or fewer than two of the six actually traded */
  applicable: boolean;
  quarter: QuarterNo;
  /** the single month the table is narrowed to, YYYY-MM, or null for the quarter */
  month: string | null;
  fyStartYear: number;
  label: string;
  start: string;
  end: string;
  verticals: ApportionedVerticalCost[];
  directTeamCostLines: CostAccountLine[];
  directOverheadLines: CostAccountLine[];
  /** Common's own cost, by account - spread across the six by head-count share */
  commonCostLines: CostAccountLine[];
  /** ACC's and HRCM's own cost, combined by account - spread across the six by head-count share */
  accHrcmCostLines: CostAccountLine[];
  /** total cost booked under Common incl partners contribution, before spreading */
  poolTotal: number;
  /** total cost booked under ACC and HRCM combined, before spreading */
  accHrcmPoolTotal: number;
  totalHeads: number;
  /**
   * Comparison only - the same two pools spread on head count across every
   * vertical in the entity instead of just the six, so most of each pool
   * lands on heads outside the six and is never charged to any of them.
   */
  wide: {
    /** head count across the whole entity - every vertical, not just the six */
    totalCompanyHeads: number;
    /** true where totalCompanyHeads was keyed in directly; false where it is only the sum of tracked verticals */
    companyHeadsIsKeyed: boolean;
    /** the company this card's total head count is keyed against, for the save call - null where none of the six resolved to one */
    entityId: number | null;
    /** Common's pool, by account - spread across the six on the company-wide denominator */
    commonCostLines: CostAccountLine[];
    /** ACC's and HRCM's pool, by account - spread across the six on the company-wide denominator */
    accHrcmCostLines: CostAccountLine[];
    /** the slice of Common's pool this denominator leaves uncharged to any of the six */
    commonUnapportioned: number;
    /** the slice of ACC's and HRCM's pool this denominator leaves uncharged to any of the six */
    accHrcmUnapportioned: number;
  };
}

const QUARTER_LABELS = ["Q1 Apr-Jun", "Q2 Jul-Sep", "Q3 Oct-Dec", "Q4 Jan-Mar"];

export async function buildVerticalCostApportionment(opts: {
  entity: Entity;
  fyStartYear: number;
  quarter: QuarterNo;
  /** one month inside the quarter, to narrow the window and re-strike the head-count ratio on it alone */
  month?: string | null;
}): Promise<VerticalCostApportionmentResult> {
  const { entity, fyStartYear, quarter, month = null } = opts;
  const quarterMonths = fyMonths(fyStartYear).filter((m) => m.quarter === quarter);
  const picked = month ? quarterMonths.find((m) => m.key === month) : undefined;
  const months = picked ? [picked] : quarterMonths;
  const start = months[0].start;
  const end = months[months.length - 1].end;

  const [rows, headcounts, verticalRows, companyEntityRows, companyHeadcounts] = await Promise.all([
    query<{
      code: string | null;
      group_code: string | null;
      name: string;
      revenue: number;
      cost: number;
    }>(
      `select v.code, a.group_code, a.name,
              sum(case when a.group_code = 'revenue' then g.credit - g.debit else 0 end)::numeric as revenue,
              -- Other income and reimbursement recoveries are credits, so they
              -- arrive as negative cost and reduce the total exactly as they do
              -- on the P&L. Depreciation sits below EBITDA and is left out.
              sum(case when a.group_code <> 'revenue' then g.debit - g.credit else 0 end)::numeric as cost
         from gl_entries g
         join accounts a on a.id = g.account_id
         left join verticals v on v.id = g.vertical_id
        where g.entity_id = any($1::int[]) and g.txn_date between $2 and $3
          and a.statement = 'pnl'
          and a.group_code in ('revenue','direct_cost','establishment_cost','overheads',
                               'other_income','reimbursements')
        group by v.code, a.group_code, a.name`,
      [entity.memberIds, start, end],
    ),
    // Same averaging rule as buildApportionment: each month in the window
    // takes that month's own head count where one is recorded, the annual
    // baseline otherwise, and the window's figure is their average.
    query<{ code: string; heads: number }>(
      `select v.code, avg(coalesce(mh.heads, ah.heads))::numeric as heads
         from verticals v
         cross join unnest($3::date[]) as wm(month)
         left join vertical_headcount mh
           on mh.vertical_id = v.id and mh.fy_start_year = $1 and mh.month = wm.month
         left join vertical_headcount ah
           on ah.vertical_id = v.id and ah.fy_start_year = $1 and ah.month is null
        where v.entity_id = any($2::int[])
          and coalesce(mh.heads, ah.heads) is not null
        group by v.code`,
      [fyStartYear, entity.memberIds, months.map((m) => m.start)],
    ),
    query<{ id: number; code: string }>(
      `select id, code from verticals where entity_id = any($1::int[])`,
      [entity.memberIds],
    ),
    // The company the six receivers themselves belong to - RBJV, always,
    // but resolved rather than assumed so a slice or the group view still
    // saves the keyed total against the right company.
    query<{ entity_id: number }>(
      `select entity_id from verticals
        where entity_id = any($1::int[]) and code = any($2::text[])
        limit 1`,
      [entity.memberIds, RECEIVERS.map((r) => r.code)],
    ),
    // Same averaging rule as the per-vertical head count above, but for the
    // company as a whole - kept separately because summing vertical_headcount
    // only covers verticals that carry their own monthly figure, and misses
    // anyone in Common, DSC, or any other cost centre never given one.
    query<{ entity_id: number; heads: number }>(
      `select em.id as entity_id, avg(coalesce(mh.heads, ah.heads))::numeric as heads
         from unnest($2::int[]) as em(id)
         cross join unnest($3::date[]) as wm(month)
         left join company_headcount mh
           on mh.entity_id = em.id and mh.fy_start_year = $1 and mh.month = wm.month
         left join company_headcount ah
           on ah.entity_id = em.id and ah.fy_start_year = $1 and ah.month is null
        where coalesce(mh.heads, ah.heads) is not null
        group by em.id`,
      [fyStartYear, entity.memberIds, months.map((m) => m.start)],
    ),
  ]);

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const headsByCode = new Map(headcounts.map((h) => [h.code, Number(h.heads)]));
  const idByCode = new Map(verticalRows.map((v) => [v.code, v.id]));
  const receiverOf = new Map(RECEIVERS.map((r) => [r.code, r]));

  const verticals: ApportionedVerticalCost[] = RECEIVERS.map((r) => ({
    key: r.key,
    label: r.label,
    verticalId: idByCode.get(r.code) ?? null,
    heads: round2(headsByCode.get(r.code) ?? 0),
    revenue: 0,
    directTeamCost: 0,
    directOverheads: 0,
    commonApportioned: 0,
    accHrcmApportioned: 0,
    totalCost: 0,
    contribution: 0,
    commonApportionedWide: 0,
    accHrcmApportionedWide: 0,
    totalCostWide: 0,
    contributionWide: 0,
  }));
  const byKey = new Map(verticals.map((v) => [v.key, v]));

  // account name -> vertical key -> amount, for the two direct-cost lines.
  const directTeamByAccount = new Map<string, Map<string, number>>();
  const directOverheadByAccount = new Map<string, Map<string, number>>();
  // account name -> pooled amount, Common's own cost before spreading.
  const commonPool = new Map<string, number>();
  // account name -> pooled amount, ACC's and HRCM's own cost combined, before spreading.
  const accHrcmPool = new Map<string, number>();

  const addTo = (map: Map<string, Map<string, number>>, account: string, key: string, amount: number) => {
    const byVertical = map.get(account) ?? new Map<string, number>();
    byVertical.set(key, (byVertical.get(key) ?? 0) + amount);
    map.set(account, byVertical);
  };

  for (const row of rows) {
    const revenue = Number(row.revenue);
    const cost = Number(row.cost);
    const receiver = row.code ? receiverOf.get(row.code) : undefined;

    if (receiver) {
      const v = byKey.get(receiver.key)!;
      v.revenue += revenue;
      if (row.group_code === "direct_cost") {
        v.directTeamCost += cost;
        if (cost !== 0) addTo(directTeamByAccount, row.name, receiver.key, cost);
      } else {
        v.directOverheads += cost;
        if (cost !== 0) addTo(directOverheadByAccount, row.name, receiver.key, cost);
      }
      continue;
    }

    // Only Common's own booked cost is one pool, and ACC's and HRCM's own
    // booked cost (direct team cost and overheads together) is the other -
    // not untagged, unallocated, or any other vertical's activity. Their
    // revenue, and any other vertical's figures, play no part in this card.
    if (row.code === "COMMON" && cost !== 0) {
      commonPool.set(row.name, (commonPool.get(row.name) ?? 0) + cost);
    } else if ((row.code === "ACC" || row.code === "HRCM") && cost !== 0) {
      accHrcmPool.set(row.name, (accHrcmPool.get(row.name) ?? 0) + cost);
    }
  }

  const totalHeads = verticals.reduce((s, v) => s + v.heads, 0);
  const poolTotal = [...commonPool.values()].reduce((s, n) => s + n, 0);
  const accHrcmPoolTotal = [...accHrcmPool.values()].reduce((s, n) => s + n, 0);
  const companyEntityId = companyEntityRows[0]?.entity_id ?? null;
  // A keyed-in company total, where one exists, is the real denominator;
  // summing vertical_headcount is only ever a fallback estimate, since it
  // silently misses anyone in Common, DSC, or another untracked vertical.
  const companyHeadsIsKeyed = companyHeadcounts.length > 0;
  const totalCompanyHeads = companyHeadsIsKeyed
    ? companyHeadcounts.reduce((s, h) => s + round2(Number(h.heads)), 0)
    : [...headsByCode.values()].reduce((s, h) => s + round2(h), 0);

  const toLines = (map: Map<string, Map<string, number>>): CostAccountLine[] =>
    [...map.entries()].map(([account, byVertical]) => {
      const amountByKey: Record<string, number> = {};
      let total = 0;
      for (const v of verticals) {
        const amount = byVertical.get(v.key) ?? 0;
        amountByKey[v.key] = amount;
        total += amount;
      }
      return { account, amountByKey, total };
    });

  const commonCostLines: CostAccountLine[] = [...commonPool.entries()].map(([account, amount]) => {
    const amountByKey: Record<string, number> = {};
    for (const v of verticals) {
      const share = totalHeads > 0 ? amount * (v.heads / totalHeads) : amount / verticals.length;
      amountByKey[v.key] = share;
      v.commonApportioned += share;
    }
    return { account, amountByKey, total: amount };
  });

  const accHrcmCostLines: CostAccountLine[] = [...accHrcmPool.entries()].map(([account, amount]) => {
    const amountByKey: Record<string, number> = {};
    for (const v of verticals) {
      const share = totalHeads > 0 ? amount * (v.heads / totalHeads) : amount / verticals.length;
      amountByKey[v.key] = share;
      v.accHrcmApportioned += share;
    }
    return { account, amountByKey, total: amount };
  });

  // Comparison only: the same two pools, spread on the same head-count rule
  // but over every head in the entity rather than just the six. A vertical's
  // own head count is unchanged; only the denominator widens, so each share
  // shrinks and the balance is left uncharged to any of the six below.
  const commonCostLinesWide: CostAccountLine[] = [...commonPool.entries()].map(([account, amount]) => {
    const amountByKey: Record<string, number> = {};
    for (const v of verticals) {
      const share = totalCompanyHeads > 0 ? amount * (v.heads / totalCompanyHeads) : 0;
      amountByKey[v.key] = share;
      v.commonApportionedWide += share;
    }
    return { account, amountByKey, total: amount };
  });

  const accHrcmCostLinesWide: CostAccountLine[] = [...accHrcmPool.entries()].map(([account, amount]) => {
    const amountByKey: Record<string, number> = {};
    for (const v of verticals) {
      const share = totalCompanyHeads > 0 ? amount * (v.heads / totalCompanyHeads) : 0;
      amountByKey[v.key] = share;
      v.accHrcmApportionedWide += share;
    }
    return { account, amountByKey, total: amount };
  });

  for (const v of verticals) {
    v.totalCost = v.directTeamCost + v.directOverheads + v.commonApportioned + v.accHrcmApportioned;
    v.contribution = v.revenue - v.totalCost;
    v.totalCostWide = v.directTeamCost + v.directOverheads + v.commonApportionedWide + v.accHrcmApportionedWide;
    v.contributionWide = v.revenue - v.totalCostWide;
  }

  const commonUnapportioned = poolTotal - verticals.reduce((s, v) => s + v.commonApportionedWide, 0);
  const accHrcmUnapportioned = accHrcmPoolTotal - verticals.reduce((s, v) => s + v.accHrcmApportionedWide, 0);

  // Two or more of the six actually traded, and there is a pool to spread
  // between them. Head count is a standing figure and would make an empty
  // quarter look populated, so it does not count as activity on its own.
  const active = verticals.filter((v) => v.revenue !== 0 || v.directTeamCost !== 0 || v.directOverheads !== 0).length;

  return {
    applicable: active > 1 && (poolTotal !== 0 || accHrcmPoolTotal !== 0),
    quarter,
    month: picked ? picked.key : null,
    fyStartYear,
    label: picked ? picked.label : QUARTER_LABELS[quarter - 1],
    start,
    end,
    verticals,
    directTeamCostLines: toLines(directTeamByAccount),
    directOverheadLines: toLines(directOverheadByAccount),
    commonCostLines,
    accHrcmCostLines,
    poolTotal,
    accHrcmPoolTotal,
    totalHeads,
    wide: {
      totalCompanyHeads,
      companyHeadsIsKeyed,
      entityId: companyEntityId,
      commonCostLines: commonCostLinesWide,
      accHrcmCostLines: accHrcmCostLinesWide,
      commonUnapportioned,
      accHrcmUnapportioned,
    },
  };
}

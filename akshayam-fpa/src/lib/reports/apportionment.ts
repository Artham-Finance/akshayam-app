import { query } from "@/lib/db";
import type { Entity } from "@/lib/entity";
import { fyMonths, type QuarterNo } from "@/lib/period";
import { RULES, type Basis } from "@/lib/reports/apportionment-rules";

// Re-exported so callers that already import from here keep working.
export { BASIS_LABEL, HEAD_BASIS, RULES } from "@/lib/reports/apportionment-rules";
export type { Basis } from "@/lib/reports/apportionment-rules";

/**
 * Common cost apportioned to the verticals that carry it.
 *
 * The budget's own "Common Cost Apportionment Statement" spreads shared cost
 * four ways, and this applies those same four bases to the *actual* pool. That
 * is what makes it usable for VPP: the share a vertical is charged follows the
 * rule the partners already agreed, and only the amount changes as the year
 * runs.
 *
 *   equal9    one ninth each - the costs nobody can attribute at all
 *   equal8    one eighth, excluding Gift & Regulatory, which buys its own
 *   revenue   in proportion to revenue earned in the period
 *   heads     in proportion to head count, in two variants
 *
 * The pool is what the ledger tagged COMMON or left untagged. A cost already
 * tagged to a vertical is that vertical's own and is never re-spread.
 */

/** The nine verticals the budget apportions to, keyed by the codes in the ledger. */
const RECEIVERS: { key: string; label: string; codes: string[] }[] = [
  { key: "ECM", label: "Vasudharini — ECM", codes: ["ECM"] },
  { key: "GADD", label: "Ekta — GADD", codes: ["GADD"] },
  { key: "CMRGA", label: "Gayathri — CMRGA", codes: ["CMRGA"] },
  { key: "DLR", label: "Vijay — DLR", codes: ["DLR"] },
  { key: "RRG", label: "Dharshan — RRG", codes: ["RRG"] },
  { key: "CFC", label: "Rekha — CFC", codes: ["CFC"] },
  { key: "ACC", label: "Meenakshi — ACC", codes: ["ACC"] },
  { key: "HRCM", label: "Mahalakshmi — HRCM", codes: ["HRCM"] },
  // One book across two companies, exactly as the budget treats V10.
  { key: "GIFT", label: "Raja — Gift & Regulatory", codes: ["GIFT", "AIF"] },
];

const EXCL_GIFT = RECEIVERS.filter((r) => r.key !== "GIFT");

/**
 * The apportionment column a ledger vertical belongs to, or null for one the
 * budget does not apportion to.
 *
 * AIF and GIFT share Raja's column, so a caller narrowing the table to a
 * picked vertical cannot simply match on the code - which is exactly the kind
 * of mapping that should live beside the table it describes rather than being
 * re-derived by whoever renders it.
 */
export function receiverKeyFor(code: string | null | undefined): string | null {
  if (!code) return null;
  return RECEIVERS.find((r) => r.codes.includes(code))?.key ?? null;
}

export interface ApportionedVertical {
  key: string;
  label: string;
  /**
   * False for the lines that sit outside the budget's nine - Common, partner
   * contribution, anything untagged. They are shown so the table's total is
   * the whole company and can be checked against EBITDA, but they receive no
   * apportionment: Common's cost *is* the pool, and the other two are not part
   * of the arrangement.
   */
  receivesApportionment: boolean;
  revenue: number;
  directCost: number;
  /** head of cost -> amount charged to this vertical */
  apportioned: Record<string, number>;
  apportionedTotal: number;
  totalCost: number;
  /** revenue less all cost: the figure VPP is struck on */
  contribution: number;
  heads: number;
}

export interface ApportionmentResult {
  /**
   * False where there is nothing to apportion.
   *
   * Sharing cost out is RBJV's arrangement: one pool of common cost spread
   * over the verticals that use it. Akshayam is a single vertical whose costs
   * are all its own, so the statement has nothing to divide and no one to
   * divide it between - it rendered as a grid of zeros, which reads as a
   * broken report rather than an inapplicable one.
   */
  applicable: boolean;
  quarter: QuarterNo;
  label: string;
  start: string;
  end: string;
  heads: string[];
  verticals: ApportionedVertical[];
  /** cost that was tagged COMMON or left untagged, before spreading */
  pool: Record<string, number>;
  poolTotal: number;
  /** activity outside the nine budgeted verticals, shown rather than dropped */
  outside: { label: string; revenue: number; directCost: number }[];
}

export async function buildApportionment(opts: {
  entity: Entity;
  fyStartYear: number;
  quarter: QuarterNo;
  /**
   * One month inside the quarter, to narrow the window to it.
   *
   * VPP is struck quarterly, so the quarter is the figure that counts. A month
   * is worth seeing all the same - it is where a cost that looks odd across
   * three months turns out to have landed - but the bases are re-struck on
   * that month alone, so a month's share is not a third of the quarter's.
   */
  month?: string | null;
}): Promise<ApportionmentResult> {
  const { entity, fyStartYear, quarter, month = null } = opts;
  const quarterMonths = fyMonths(fyStartYear).filter((m) => m.quarter === quarter);
  const picked = month ? quarterMonths.find((m) => m.key === month) : undefined;
  const months = picked ? [picked] : quarterMonths;
  const start = months[0].start;
  const end = months[months.length - 1].end;
  const labels = ["Q1 Apr-Jun", "Q2 Jul-Sep", "Q3 Oct-Dec", "Q4 Jan-Mar"];

  const [rows, headcounts] = await Promise.all([
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
    query<{ code: string; heads: number }>(
      `select v.code, sum(h.heads)::int as heads
         from vertical_headcount h join verticals v on v.id = h.vertical_id
        where h.fy_start_year = $1 and v.entity_id = any($2::int[])
        group by v.code`,
      [fyStartYear, entity.memberIds],
    ),
  ]);

  const headsByCode = new Map(headcounts.map((h) => [h.code, Number(h.heads)]));
  const receiverOf = new Map<string, (typeof RECEIVERS)[number]>();
  for (const r of RECEIVERS) for (const code of r.codes) receiverOf.set(code, r);

  const verticals: ApportionedVertical[] = RECEIVERS.map((r) => ({
    key: r.key,
    label: r.label,
    receivesApportionment: true,
    revenue: 0,
    directCost: 0,
    apportioned: {},
    apportionedTotal: 0,
    totalCost: 0,
    contribution: 0,
    heads: r.codes.reduce((sum, c) => sum + (headsByCode.get(c) ?? 0), 0),
  }));
  const byKey = new Map(verticals.map((v) => [v.key, v]));

  const pool: Record<string, number> = {};
  const outside = new Map<string, { label: string; revenue: number; directCost: number }>();

  for (const row of rows) {
    const revenue = Number(row.revenue);
    const cost = Number(row.cost);
    const receiver = row.code ? receiverOf.get(row.code) : undefined;

    if (receiver) {
      const v = byKey.get(receiver.key)!;
      v.revenue += revenue;
      v.directCost += cost;
      continue;
    }

    // COMMON and untagged cost is the pool; anything else outside the nine
    // (partner contribution, unallocated) is shown but never spread.
    const isPool = !row.code || row.code === "COMMON" || row.code === "UNALLOCATED";
    if (isPool && cost !== 0) {
      const rule =
        RULES.find(
          (r) =>
            (!r.group || r.group === row.group_code) && (!r.name || r.name.test(row.name)),
        ) ?? RULES[RULES.length - 1];
      pool[rule.head] = (pool[rule.head] ?? 0) + cost;
    }
    /**
     * Everything else becomes its own line: Common's revenue, the partner
     * contribution, anything untagged. They receive no apportionment, but they
     * are part of the company and leaving them off is what made this table's
     * total disagree with EBITDA on the Budget vs Actual page.
     *
     * Common's *cost* is the pool and has already been spread, so only its
     * revenue appears here - counting it twice would be worse than omitting it.
     */
    if (!isPool || revenue !== 0) {
      const label = row.code ?? "Not attributed to a vertical";
      const existing = outside.get(label) ?? { label, revenue: 0, directCost: 0 };
      existing.revenue += revenue;
      if (!isPool) existing.directCost += cost;
      outside.set(label, existing);
    }
  }

  const NAMES: Record<string, string> = {
    COMMON: "Common — cost spread above",
    PARTNER: "Partner contribution",
    UNALLOCATED: "Unallocated",
  };
  for (const o of outside.values()) {
    if (o.revenue === 0 && o.directCost === 0) continue;
    verticals.push({
      key: o.label,
      label: NAMES[o.label] ?? o.label,
      receivesApportionment: false,
      revenue: o.revenue,
      directCost: o.directCost,
      apportioned: {},
      apportionedTotal: 0,
      totalCost: o.directCost,
      contribution: o.revenue - o.directCost,
      heads: 0,
    });
  }

  // ---------- spread the pool ----------

  // Only the nine share the pool, so only the nine set the ratios. Including
  // Common's revenue in the denominator would quietly shrink every vertical's
  // share and leave part of the pool unspread.
  const receiving = verticals.filter((v) => v.receivesApportionment);
  const totalRevenue = receiving.reduce((s, v) => s + v.revenue, 0);
  const totalHeads = receiving.reduce((s, v) => s + v.heads, 0);
  const headsExclGift = EXCL_GIFT.reduce((s, r) => s + (byKey.get(r.key)?.heads ?? 0), 0);

  const weight = (v: ApportionedVertical, basis: Basis): number => {
    switch (basis) {
      case "equal9":
        return 1 / RECEIVERS.length;
      case "equal8":
        return v.key === "GIFT" ? 0 : 1 / EXCL_GIFT.length;
      case "revenue":
        // With no revenue anywhere the ratio is undefined; fall back to equal
        // shares rather than dropping the cost off the statement.
        return totalRevenue > 0 ? v.revenue / totalRevenue : 1 / RECEIVERS.length;
      case "headsAll":
        return totalHeads > 0 ? v.heads / totalHeads : 1 / RECEIVERS.length;
      case "headsExclGift":
        if (v.key === "GIFT") return 0;
        return headsExclGift > 0 ? v.heads / headsExclGift : 1 / EXCL_GIFT.length;
    }
  };

  const heads: string[] = [];
  for (const rule of RULES) {
    const amount = pool[rule.head];
    if (!amount) continue;
    heads.push(rule.head);
    for (const v of receiving) {
      const share = amount * weight(v, rule.basis);
      if (share === 0) continue;
      v.apportioned[rule.head] = (v.apportioned[rule.head] ?? 0) + share;
    }
  }

  for (const v of verticals) {
    v.apportionedTotal = Object.values(v.apportioned).reduce((s, n) => s + n, 0);
    v.totalCost = v.directCost + v.apportionedTotal;
    v.contribution = v.revenue - v.totalCost;
  }

  // Two or more of the nine actually traded, and there is a pool to spread
  // between them. Head count is a standing figure and would make an empty
  // quarter look populated, so it does not count as activity.
  const active = receiving.filter((v) => v.revenue !== 0 || v.directCost !== 0).length;
  const poolTotal = Object.values(pool).reduce((s, n) => s + n, 0);

  return {
    applicable: active > 1 && poolTotal !== 0,
    quarter,
    label: picked ? picked.label : labels[quarter - 1],
    start,
    end,
    heads,
    verticals,
    pool,
    poolTotal,
    outside: [...outside.values()].filter((o) => o.revenue !== 0 || o.directCost !== 0),
  };
}

/** The basis each head of cost is spread on, for showing the reader the rule. */

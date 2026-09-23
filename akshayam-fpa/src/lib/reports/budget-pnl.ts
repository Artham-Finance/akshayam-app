import { query } from "@/lib/db";
import { verticalScope, type Entity } from "@/lib/entity";
import { fyBounds, fyMonths, type FyMonth } from "@/lib/period";
import {
  PRESENTATIONAL_TAX_RATE,
  taxedMembers,
} from "@/lib/reports/presentational-tax";

/**
 * Budget versus actual, down the P&L.
 *
 * The layout is the firm's own, and shorter than the statement pages: revenue,
 * three cost lines, EBITDA, what sits below it, and the drawings that take
 * profit out to the partners. It stops where the partners' question stops -
 * what was left, and what is left after they took theirs.
 *
 * Budget and actual are the same definition on both sides. Neither column
 * stores its subtotals: EBITDA, PBT, PAT and retained profit are computed here
 * from the lines, so a budget total can never be struck differently from the
 * actual beside it.
 */

export type BvaCode =
  | "revenue"
  | "direct_cost"
  | "establishment_cost"
  | "overheads"
  | "common_cost_apportionment"
  | "ebitda"
  | "depreciation"
  | "finance_cost"
  | "pbt"
  | "tax"
  | "pat"
  | "partner_drawings"
  | "retained";

export interface BvaLine {
  code: BvaCode;
  name: string;
  /** -1 = a cost, shown positive but subtracting */
  sign: 1 | -1;
  isSubtotal: boolean;
  /** month key -> amount, actual */
  actual: Record<string, number>;
  /** month key -> amount, budget */
  budget: Record<string, number>;
}

export interface BvaResult {
  months: FyMonth[];
  lines: BvaLine[];
  /** true when no budget has been loaded for this entity and year */
  hasBudget: boolean;
}

/** The statement, in order. Subtotals name the lines they sum. */
const LAYOUT: {
  code: BvaCode;
  name: string;
  sign: 1 | -1;
  subtotalOf?: BvaCode[];
}[] = [
  { code: "revenue", name: "Revenue", sign: 1 },
  { code: "direct_cost", name: "Team cost", sign: -1 },
  { code: "establishment_cost", name: "Establishment cost", sign: -1 },
  // Named to match the account-mapping screen's own P&L group - there is no
  // separate "Other expenses" group to map a ledger account to, so a label
  // that agreed with neither would only ever be explained away.
  { code: "overheads", name: "Overheads", sign: -1 },
  { code: "common_cost_apportionment", name: "Common cost apportionment", sign: -1 },
  {
    code: "ebitda",
    name: "EBITDA",
    sign: 1,
    subtotalOf: [
      "revenue",
      "direct_cost",
      "establishment_cost",
      "overheads",
      "common_cost_apportionment",
    ],
  },
  { code: "depreciation", name: "Depreciation", sign: -1 },
  { code: "finance_cost", name: "Interest expenses", sign: -1 },
  { code: "pbt", name: "Profit before tax", sign: 1, subtotalOf: ["ebitda", "depreciation", "finance_cost"] },
  { code: "tax", name: "Tax", sign: -1 },
  { code: "pat", name: "Profit after tax", sign: 1, subtotalOf: ["pbt", "tax"] },
  { code: "partner_drawings", name: "Partners' drawings", sign: -1 },
  { code: "retained", name: "Reserves and surplus", sign: 1, subtotalOf: ["pat", "partner_drawings"] },
];

/**
 * Where each P&L group lands on this statement.
 *
 * Reimbursements and other income join "Other expenses" rather than getting
 * lines of their own: reimbursement is a recharge that nets to almost nothing,
 * and both are small enough that a line each would lengthen the statement
 * without telling anyone something they act on. They still reach EBITDA.
 */
const GROUP_TO_LINE: Record<string, BvaCode> = {
  revenue: "revenue",
  other_income: "overheads",
  reimbursements: "overheads",
  direct_cost: "direct_cost",
  establishment_cost: "establishment_cost",
  overheads: "overheads",
  common_cost_apportionment: "common_cost_apportionment",
  depreciation: "depreciation",
  finance_cost: "finance_cost",
  tax: "tax",
  partner_drawings: "partner_drawings",
};

const empty = (months: FyMonth[]) => Object.fromEntries(months.map((m) => [m.key, 0]));

export async function buildBudgetVsActualPnl(opts: {
  entity: Entity;
  fyStartYear: number;
  verticalId?: number | null;
  /**
   * A sub-year window for the actual side only. The budget still loads the
   * whole year (the caller sums it over whole months); the ledger figure is
   * for the exact dates.
   */
  window?: { start: string; end: string };
}): Promise<BvaResult> {
  const { entity, fyStartYear, verticalId = null, window } = opts;
  const months = fyMonths(fyStartYear);
  const fyRange = fyBounds(fyStartYear);
  const start = window?.start ?? fyRange.start;
  const end = window?.end ?? fyRange.end;

  const [glRows, osbRows, budgetRows, commonCostActualRows] = await Promise.all([
    query<{ month_key: string; group_code: string | null; amount: number }>(
      // credit - debit, so income is positive and a cost negative: the same
      // convention the P&L page uses, which is what lets the two agree.
      `select to_char(g.txn_date, 'YYYY-MM') as month_key,
              a.group_code,
              sum(g.credit - g.debit) as amount
         from gl_entries g
         join accounts a on a.id = g.account_id
        where g.entity_id = any($1::int[]) and g.txn_date between $2 and $3
          and a.statement = 'pnl'
          and not ($4::boolean and a.is_intercompany)
          and ($5::int is null or g.vertical_id = $5)
          ${verticalScope("$6", "g.vertical_id")}
        group by 1, 2`,
      [entity.memberIds, start, end, entity.consolidates, verticalId, entity.verticalIds],
    ),
    /**
     * Outside-books revenue folded straight into the Revenue line - it has no
     * gl_entries row above to carry its own group_code, and this statement
     * has no line of its own for it the way the P&L does, so the group_code
     * is stated as 'revenue' directly rather than read from an account. Same
     * source buildProfitAndLoss and actualsByVertical read, so all three
     * total OSB revenue the same way.
     */
    query<{ month_key: string; group_code: string; amount: number }>(
      `select to_char(i.invoice_date, 'YYYY-MM') as month_key,
              'revenue' as group_code,
              sum(i.amount_base) as amount
         from invoice_lines i
        where i.entity_id = any($1::int[]) and i.is_osb
          and i.invoice_date between $2 and $3
          and ($4::int is null or i.vertical_id = $4)
          ${verticalScope("$5", "i.vertical_id")}
        group by 1`,
      [entity.memberIds, start, end, verticalId, entity.verticalIds],
    ),
    /**
     * The budget is held for the entity itself, not summed from members: the
     * consolidated sheet is its own schedule and already excludes the common
     * cost Akshayam is charged by RBJV, which adding the two companies would
     * double.
     */
    query<{ month_key: string; group_code: string; amount: number }>(
      `select to_char(month, 'YYYY-MM') as month_key, group_code, sum(amount) as amount
         from budget_pnl
        where entity_id = $1 and fy_start_year = $2
        group by 1, 2`,
      [entity.id, fyStartYear],
    ),
    /**
     * "Common cost apportionment" has no ledger posting of its own - Zoho
     * never books it - so its actual is keyed in by hand instead, month by
     * month, the same annual-baseline-or-monthly shape company_headcount and
     * vertical_headcount use. Read for the whole year, same as the budget
     * beside it; a month nobody has keyed in yet simply reads nil.
     */
    query<{ month_key: string; amount: number }>(
      `select to_char(wm.month, 'YYYY-MM') as month_key,
              coalesce(mh.amount, ah.amount) as amount
         from unnest($3::date[]) as wm(month)
         left join common_cost_apportionment_actual mh
           on mh.entity_id = $1 and mh.fy_start_year = $2 and mh.month = wm.month
         left join common_cost_apportionment_actual ah
           on ah.entity_id = $1 and ah.fy_start_year = $2 and ah.month is null
        where coalesce(mh.amount, ah.amount) is not null`,
      [entity.id, fyStartYear, months.map((m) => m.start)],
    ),
  ]);

  const lines: BvaLine[] = LAYOUT.map((l) => ({
    code: l.code,
    name: l.name,
    sign: l.sign,
    isSubtotal: !!l.subtotalOf,
    actual: empty(months),
    budget: empty(months),
  }));
  const byCode = new Map(lines.map((l) => [l.code, l]));
  const valid = new Set(months.map((m) => m.key));

  for (const row of [...glRows, ...osbRows]) {
    if (!valid.has(row.month_key)) continue;
    const code = row.group_code ? GROUP_TO_LINE[row.group_code] : undefined;
    // An account with no reporting line has nowhere to sit on a statement this
    // short; the P&L page is where it gets chased, and it is flagged there.
    if (!code) continue;
    const line = byCode.get(code)!;
    // Costs are stored credit - debit, so they arrive negative. This statement
    // shows every line as a positive magnitude and lets the sign do the work.
    line.actual[row.month_key] += Number(row.amount) * (line.sign === -1 ? -1 : 1);
  }

  for (const row of budgetRows) {
    if (!valid.has(row.month_key)) continue;
    const line = byCode.get(row.group_code as BvaCode);
    if (!line) continue;
    // The budget stores costs as positive magnitudes already.
    line.budget[row.month_key] += Number(row.amount);
  }

  /**
   * Partners take their budgeted draw every month. It is a balance-sheet
   * movement, not a P&L cost, so the ledger's P&L never carries it and the
   * actual would otherwise read nil against a real budget - a variance that is
   * only ever "not booked here". The firm's convention is that the draw is
   * taken as planned, so the actual follows the budget, month by month.
   */
  const drawings = byCode.get("partner_drawings")!;
  for (const m of months) drawings.actual[m.key] = drawings.budget[m.key];

  const commonCostApportionment = byCode.get("common_cost_apportionment")!;
  for (const row of commonCostActualRows) {
    if (!valid.has(row.month_key)) continue;
    commonCostApportionment.actual[row.month_key] += Number(row.amount);
  }

  // Recomputes one subtotal from the lines under it. Pulled out so the tax
  // line below can be filled in after the fact and PAT/retained struck again
  // from it, without repeating this loop by hand.
  const recompute = (code: BvaCode) => {
    const spec = LAYOUT.find((l) => l.code === code)!;
    if (!spec.subtotalOf) return;
    const target = byCode.get(code)!;
    for (const m of months) {
      let actual = 0;
      let budget = 0;
      for (const source of spec.subtotalOf) {
        const from = byCode.get(source)!;
        // A cost line holds a positive magnitude, so it subtracts here.
        const factor = from.sign === -1 ? -1 : 1;
        actual += from.actual[m.key] * factor;
        budget += from.budget[m.key] * factor;
      }
      target.actual[m.key] = actual;
      target.budget[m.key] = budget;
    }
  };

  for (const spec of LAYOUT) {
    if (spec.subtotalOf) recompute(spec.code);
  }

  /**
   * Presentational tax on the actual column only - the budget already carries
   * whatever tax the firm entered for it. Neither company passes a tax entry
   * through the ledger, so without this the actual column understates its
   * own cost against a budget that plans for one. Same rates, and the same
   * "sum of members" reasoning for the group, as the P&L and Balance Sheet.
   */
  if (verticalId === null) {
    const tax = byCode.get("tax")!;
    const rate = PRESENTATIONAL_TAX_RATE[entity.slug];
    if (rate) {
      const pbt = byCode.get("pbt")!;
      let cumulativePbt = 0;
      let cumulativeTax = 0;
      for (const m of months) {
        cumulativePbt += pbt.actual[m.key];
        const taxToDate = cumulativePbt > 0 ? cumulativePbt * (rate / 100) : 0;
        tax.actual[m.key] = taxToDate - cumulativeTax;
        cumulativeTax = taxToDate;
      }
    } else if (entity.isGroup) {
      const members = await taxedMembers(entity);
      for (const member of members) {
        const memberResult = await buildBudgetVsActualPnl({ entity: member, fyStartYear, window });
        const memberTax = memberResult.lines.find((l) => l.code === "tax");
        if (!memberTax) continue;
        for (const m of months) tax.actual[m.key] += memberTax.actual[m.key];
      }
    }
    recompute("pat");
    recompute("retained");
  }

  return { months, lines, hasBudget: budgetRows.length > 0 };
}

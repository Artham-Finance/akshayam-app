import { query } from "@/lib/db";
import type { Entity } from "@/lib/entity";
import { fyBounds, type FyMonth } from "@/lib/period";

/**
 * The breakdown behind "Other expenses", budget against actual.
 *
 * The statement carries one figure a month; this is what it is made of. It is
 * the line the founder reads first, and the one where a variance is usually a
 * story rather than a rounding - so it gets its own table, and a place to
 * write the story down.
 *
 * Every line carries two windows side by side: the period the page's own
 * picker is showing, and the year to date, which is shown regardless of that
 * picker so a reader is never without the full-year story. Variance and its
 * percentage are struck on the year-to-date pair only - the period columns are
 * for comparing against the period a reader picked, not for re-litigating the
 * whole year one slice at a time.
 *
 * The actual is entered, not read from the ledger. The ledger's account names
 * do not line up with the budget's heads closely enough to be trusted, and a
 * figure matched by name would be wrong in a way nobody could see. Each line's
 * actual is therefore the sum of the bills recorded under it - a date, a
 * vendor, an amount - which makes the detail the figure rather than a note
 * beside it.
 *
 * The ledger is still shown, once, at the foot: what it posted for the whole
 * of Other expenses, so the entered total can be checked against it. That is a
 * control, not a source.
 */

export interface ExpenseEntry {
  id: number;
  spentOn: string;
  vendor: string | null;
  amount: number;
  remark: string | null;
}

export interface ExpenseDetailLine {
  head: string;
  label: string;
  /** true where the head has no breakdown and stands as its own line */
  isHeadOnly: boolean;
  /** a line the budget never carries — actual is captured, budget stays nil */
  isActualOnly?: boolean;
  /** actual comes straight from the ledger, not from keyed entries — read-only */
  isLedger?: boolean;
  /** actual is a deduction: it subtracts from the Other-expenses total */
  isDeduction?: boolean;
  /** small caption under the label, e.g. what an abbreviation stands for */
  hint?: string;
  sortOrder: number;
  /** the budget for the page's own period - whatever the global picker shows */
  periodBudget: number;
  /** the sum of entries recorded in that period */
  periodActual: number;
  /** the budget from the start of the year to the ledger's latest month, always */
  ytdBudget: number;
  /** the sum of entries recorded year to date */
  ytdActual: number;
  /** ytdBudget less ytdActual, sign-adjusted for a deduction line */
  ytdVariance: number;
  /** ytdVariance as a percentage of ytdBudget, null when there is no YTD budget */
  ytdVariancePct: number | null;
  /**
   * The bills recorded in the picker's own period, newest first - an entry
   * belongs to the month it was spent in, so only the period's own bills are
   * ever opened or added to here, regardless of how the year-to-date columns
   * read.
   */
  entries: ExpenseEntry[];
}

export interface ExpenseDetailResult {
  /** true once a breakdown has been loaded for this entity and year */
  hasDetail: boolean;
  lines: ExpenseDetailLine[];
  totals: {
    periodBudget: number;
    periodActual: number;
    ytdBudget: number;
    ytdActual: number;
    ytdVariance: number;
    ytdVariancePct: number | null;
  };
  /**
   * The same "Other expenses" the statement above shows, so the entered total
   * can be seen to agree with the ledger - or seen not to, which is the more
   * useful case. Kept for both windows; the page's reconciliation notice reads
   * the period pair, since that is the window an entry is actually keyed against.
   */
  statement: {
    period: { budget: number; ledger: number };
    ytd: { budget: number; ledger: number };
  };
  /** vendors already used on this entity's entries, plus the ledger's own */
  vendors: string[];
}

/** The groups that together make up the statement's "Other expenses" line. */
const POOL_GROUPS = ["overheads", "other_income", "reimbursements"];

export async function buildExpenseDetail(opts: {
  entity: Entity;
  fyStartYear: number;
  /** the months being compared on, from the page's period picker */
  periodMonths: FyMonth[];
  /** the months from the start of the year to the ledger's latest month */
  ytdMonths: FyMonth[];
}): Promise<ExpenseDetailResult> {
  const { entity, fyStartYear, periodMonths, ytdMonths } = opts;
  const periodKeys = new Set(periodMonths.map((m) => m.key));
  const ytdKeys = new Set(ytdMonths.map((m) => m.key));
  // Every query below reads the whole financial year, once, and is bucketed
  // into the two windows in JS - cheaper than asking the database for the
  // same figures twice, and it keeps the two windows reading the same rows.
  const { start: fyStart, end: fyEnd } = fyBounds(fyStartYear, entity.fy_start_month);

  const [budgetRows, entryRows, ledgerRows, statementRows, vendorRows, reimbRows] = await Promise.all([
    query<{ head: string; label: string; month_key: string; sort_order: number; amount: number }>(
      `select head, label, to_char(month, 'YYYY-MM') as month_key, sort_order, amount
         from expense_budget_lines
        where entity_id = $1 and fy_start_year = $2`,
      [entity.id, fyStartYear],
    ),
    query<{
      id: number;
      head: string;
      label: string;
      month_key: string;
      spent_on: string;
      vendor: string | null;
      amount: number;
      remark: string | null;
    }>(
      `select id, head, label, to_char(month, 'YYYY-MM') as month_key,
              spent_on::text, vendor, amount, remark
         from expense_entries
        where entity_id = $1 and fy_start_year = $2
        order by spent_on desc, id desc`,
      [entity.id, fyStartYear],
    ),
    // Debit less credit, so a cost is positive - the direction the breakdown
    // is read in. Shown only as the control total at the foot, both windows.
    query<{ month_key: string; amount: number }>(
      `select to_char(g.txn_date, 'YYYY-MM') as month_key,
              coalesce(sum(g.debit - g.credit), 0)::numeric as amount
         from gl_entries g
         join accounts a on a.id = g.account_id
        where g.entity_id = any($1::int[]) and g.txn_date between $2 and $3
          and a.statement = 'pnl' and a.group_code = any($4::text[])
          and not ($5::boolean and a.is_intercompany)
        group by 1`,
      [entity.memberIds, fyStart, fyEnd, POOL_GROUPS, entity.consolidates],
    ),
    query<{ month_key: string; amount: number }>(
      `select to_char(month, 'YYYY-MM') as month_key, sum(amount) as amount
         from budget_pnl
        where entity_id = $1 and fy_start_year = $2 and group_code = 'overheads'
        group by 1`,
      [entity.id, fyStartYear],
    ),
    /**
     * Names to offer on the entry form.
     *
     * Vendors already typed, plus whoever the ledger has been billed by under
     * these accounts. Zoho leaves contact_name empty on a journal, so the name
     * has to come from the description, and only on the transaction types that
     * are actually a purchase - an invoice's description is a customer.
     *
     * Bank accounts are filtered out: they are how a bill was paid, not who it
     * was paid to, and they would crowd out the real names.
     *
     * Suggesting a name is not the same as picking an amount. Nothing here
     * reaches a figure.
     */
    query<{ vendor: string }>(
      `select distinct vendor from (
         select vendor from expense_entries
          where entity_id = $1 and vendor is not null and vendor <> ''
         union
         select trim(g.description) as vendor
           from gl_entries g
           join accounts a on a.id = g.account_id
          where g.entity_id = any($2::int[])
            and a.statement = 'pnl' and a.group_code = any($3::text[])
            and g.txn_type in ('bill', 'expense', 'vendor_payment')
            and g.description is not null and length(trim(g.description)) between 3 and 80
            and g.description !~* '(bank|a/c|account)'
            and g.description !~ '[0-9]{6,}'
       ) v order by vendor`,
      [entity.id, entity.memberIds, POOL_GROUPS],
    ),
    /**
     * Reimbursements, straight from the ledger, split into the two sides the
     * breakdown shows as their own lines. The reimbursements group holds one
     * income account and one expense account; the name is what tells them
     * apart. Debit-positive for the expense, credit-positive for the income -
     * each read in its own natural direction.
     */
    query<{ month_key: string; expense: number; income: number }>(
      `select to_char(g.txn_date, 'YYYY-MM') as month_key,
              coalesce(sum(g.debit - g.credit) filter (where a.name not ilike '%income%'), 0)::numeric as expense,
              coalesce(sum(g.credit - g.debit) filter (where a.name ilike '%income%'), 0)::numeric as income
         from gl_entries g
         join accounts a on a.id = g.account_id
        where g.entity_id = any($1::int[]) and g.txn_date between $2 and $3
          and a.statement = 'pnl' and a.group_code = 'reimbursements'
          and not ($4::boolean and a.is_intercompany)
        group by 1`,
      [entity.memberIds, fyStart, fyEnd, entity.consolidates],
    ),
  ]);

  const bucketSum = (rows: { month_key: string; amount: number }[], keys: Set<string>) =>
    rows.filter((r) => keys.has(r.month_key)).reduce((s, r) => s + Number(r.amount), 0);

  type RawEntry = ExpenseEntry & { monthKey: string };
  const allEntriesByLine = new Map<string, RawEntry[]>();
  for (const row of entryRows) {
    const key = `${row.head}|${row.label}`;
    const list = allEntriesByLine.get(key) ?? [];
    list.push({
      id: row.id,
      spentOn: row.spent_on,
      vendor: row.vendor,
      amount: Number(row.amount),
      remark: row.remark,
      monthKey: row.month_key,
    });
    allEntriesByLine.set(key, list);
  }
  const sumEntries = (raw: RawEntry[], keys: Set<string>) =>
    raw.filter((e) => keys.has(e.monthKey)).reduce((s, e) => s + e.amount, 0);
  const entriesFor = (raw: RawEntry[]): ExpenseEntry[] =>
    raw
      .filter((e) => periodKeys.has(e.monthKey))
      .map(({ id, spentOn, vendor, amount, remark }) => ({ id, spentOn, vendor, amount, remark }));

  // One row per (head, label), the budget summed into the two windows -
  // reproducing the "group by head, label" the single-window query used to do.
  const budgetByLine = new Map<
    string,
    { head: string; label: string; sortOrder: number; periodBudget: number; ytdBudget: number }
  >();
  for (const row of budgetRows) {
    const key = `${row.head}|${row.label}`;
    const cur =
      budgetByLine.get(key) ??
      { head: row.head, label: row.label, sortOrder: Number(row.sort_order), periodBudget: 0, ytdBudget: 0 };
    cur.sortOrder = Math.min(cur.sortOrder, Number(row.sort_order));
    if (periodKeys.has(row.month_key)) cur.periodBudget += Number(row.amount);
    if (ytdKeys.has(row.month_key)) cur.ytdBudget += Number(row.amount);
    budgetByLine.set(key, cur);
  }
  const lineDefs = [...budgetByLine.values()].sort((a, b) => a.sortOrder - b.sortOrder);

  const headCounts = new Map<string, number>();
  for (const def of lineDefs) {
    headCounts.set(def.head, (headCounts.get(def.head) ?? 0) + 1);
  }

  const lines: ExpenseDetailLine[] = lineDefs.map((def) => {
    const raw = allEntriesByLine.get(`${def.head}|${def.label}`) ?? [];
    const periodActual = sumEntries(raw, periodKeys);
    const ytdActual = sumEntries(raw, ytdKeys);
    const ytdVariance = def.ytdBudget - ytdActual;
    return {
      head: def.head,
      label: def.label,
      isHeadOnly: headCounts.get(def.head) === 1 && def.head === def.label,
      sortOrder: def.sortOrder,
      periodBudget: def.periodBudget,
      periodActual,
      ytdBudget: def.ytdBudget,
      ytdActual,
      ytdVariance,
      ytdVariancePct: def.ytdBudget ? (ytdVariance / def.ytdBudget) * 100 : null,
      entries: entriesFor(raw),
    };
  });

  /**
   * Lines the planning workbook never carries, added here so they survive a
   * budget re-upload (which wipes and rebuilds every row above from the sheet).
   * None has a budget:
   *
   *  - Misc (Others): bad debts, other income and anything with no budget head.
   *    Keyed by hand like any bill, at the foot of the Other Expenses breakdown.
   *  - RE less RI: reimbursement expenses and, under them, reimbursement income
   *    as a deduction. These two come straight from the ledger, month by month —
   *    the reimbursements group is a clean pair of accounts, so unlike the
   *    budget heads there is nothing to mis-match. Read-only.
   */
  const actualOnly = (
    head: string,
    label: string,
    opts: { isHeadOnly?: boolean; hint?: string; isDeduction?: boolean; sortOrder: number },
  ): ExpenseDetailLine => {
    const raw = allEntriesByLine.get(`${head}|${label}`) ?? [];
    const periodActual = sumEntries(raw, periodKeys);
    const ytdActual = sumEntries(raw, ytdKeys);
    const signedYtd = opts.isDeduction ? -ytdActual : ytdActual;
    return {
      head,
      label,
      isHeadOnly: opts.isHeadOnly ?? false,
      isActualOnly: true,
      isDeduction: opts.isDeduction,
      hint: opts.hint,
      sortOrder: opts.sortOrder,
      periodBudget: 0,
      periodActual,
      ytdBudget: 0,
      ytdActual,
      // No budget to vary from; the sign only matters where it feeds the total.
      ytdVariance: -signedYtd,
      ytdVariancePct: null,
      entries: entriesFor(raw),
    };
  };

  const lastOther = lines.map((l) => l.head).lastIndexOf("Other Expenses");
  const misc = actualOnly("Other Expenses", "Misc (Others)", {
    isHeadOnly: lastOther < 0,
    hint: "Bad debts, other income and anything with no budget line",
    sortOrder: lastOther >= 0 ? lines[lastOther].sortOrder + 1 : 9_000,
  });
  if (lastOther >= 0) lines.splice(lastOther + 1, 0, misc);
  else lines.push(misc);

  /**
   * Named lines the sheet never carries, placed at the foot of the head they
   * belong to. Each shows only when its head is on the statement, and - like
   * Misc above - survives a budget re-upload. None has a budget: the two
   * "Others (not budgeted)" lines are a catch-all for unplanned spend, and the
   * two memberships are named but budgeted as nil (the whole dues budget sits
   * on ICSI membership).
   */
  const TRAILING: { head: string; label: string }[] = [
    { head: "Computer - subscription", label: "Others (not budgeted)" },
    { head: "Computer maintenance charges", label: "Others (not budgeted)" },
    { head: "Dues and subscription", label: "IBBI membership" },
    { head: "Dues and subscription", label: "Other" },
  ];
  for (const t of TRAILING) {
    const at = lines.map((l) => l.head).lastIndexOf(t.head);
    if (at < 0) continue;
    lines.splice(
      at + 1,
      0,
      actualOnly(t.head, t.label, { sortOrder: lines[at].sortOrder + 1 }),
    );
  }

  const fromLedger = (
    label: string,
    periodActual: number,
    ytdActual: number,
    opts: { isDeduction?: boolean; sortOrder: number },
  ): ExpenseDetailLine => {
    const signedYtd = opts.isDeduction ? -ytdActual : ytdActual;
    return {
      head: "RE less RI",
      label,
      isHeadOnly: false,
      isActualOnly: true,
      isLedger: true,
      isDeduction: opts.isDeduction,
      sortOrder: opts.sortOrder,
      periodBudget: 0,
      periodActual,
      ytdBudget: 0,
      ytdActual,
      ytdVariance: -signedYtd,
      ytdVariancePct: null,
      entries: [],
    };
  };

  lines.push(
    fromLedger(
      "Reimbursement expenses",
      bucketSum(
        reimbRows.map((r) => ({ month_key: r.month_key, amount: Number(r.expense) })),
        periodKeys,
      ),
      bucketSum(
        reimbRows.map((r) => ({ month_key: r.month_key, amount: Number(r.expense) })),
        ytdKeys,
      ),
      { sortOrder: 9_998 },
    ),
    fromLedger(
      "Less - Reimbursement income",
      bucketSum(
        reimbRows.map((r) => ({ month_key: r.month_key, amount: Number(r.income) })),
        periodKeys,
      ),
      bucketSum(
        reimbRows.map((r) => ({ month_key: r.month_key, amount: Number(r.income) })),
        ytdKeys,
      ),
      { isDeduction: true, sortOrder: 9_999 },
    ),
  );

  const signedPeriodActual = (l: ExpenseDetailLine) => (l.isDeduction ? -l.periodActual : l.periodActual);
  const signedYtdActual = (l: ExpenseDetailLine) => (l.isDeduction ? -l.ytdActual : l.ytdActual);
  const sum = (pick: (l: ExpenseDetailLine) => number) => lines.reduce((s, l) => s + pick(l), 0);

  const periodBudgetTot = sum((l) => l.periodBudget);
  const periodActualTot = sum(signedPeriodActual);
  const ytdBudgetTot = sum((l) => l.ytdBudget);
  const ytdActualTot = sum(signedYtdActual);
  const ytdVarianceTot = ytdBudgetTot - ytdActualTot;

  return {
    hasDetail: lines.length > 0,
    lines,
    totals: {
      periodBudget: periodBudgetTot,
      periodActual: periodActualTot,
      ytdBudget: ytdBudgetTot,
      ytdActual: ytdActualTot,
      ytdVariance: ytdVarianceTot,
      ytdVariancePct: ytdBudgetTot ? (ytdVarianceTot / ytdBudgetTot) * 100 : null,
    },
    statement: {
      period: {
        budget: bucketSum(statementRows, periodKeys),
        ledger: bucketSum(ledgerRows, periodKeys),
      },
      ytd: {
        budget: bucketSum(statementRows, ytdKeys),
        ledger: bucketSum(ledgerRows, ytdKeys),
      },
    },
    vendors: vendorRows.map((v) => v.vendor),
  };
}

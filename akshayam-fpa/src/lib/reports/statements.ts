import { query, queryOne } from "@/lib/db";
import { verticalScope, type Entity } from "@/lib/entity";
import { fyBounds, fyMonths, type FyMonth } from "@/lib/period";

/**
 * Statement builders.
 *
 * Both statements are returned as monthly columns; quarter and year columns are
 * sums of those months, computed in the browser so collapsing a quarter never
 * needs another request.
 *
 * Sign convention:
 *   P&L  credit - debit  ->  income positive, costs negative
 *   BS   debit - credit  ->  assets positive, liabilities/equity negative
 * report_groups.sign = -1 flips a line for display only. Because the stored
 * values already carry their natural sign, every subtotal is a plain sum.
 *
 * Consolidation:
 *   Every builder takes an entity, and reads `entity.memberIds`. For a company
 *   that is one id; for the group it is both companies, and the statement is
 *   assembled from the two ledgers together. Detail rows are keyed by account
 *   *name*, so "Bank charges" in each company becomes one consolidated line
 *   while two differently-named bank accounts stay apart.
 */

export interface StatementLine {
  /** group code, or "acct:123" for a detail row */
  key: string;
  name: string;
  /** 0 = group heading/total, 1 = individual ledger account */
  level: number;
  isSubtotal: boolean;
  /** -1 means "show as positive but it subtracts", used by cost and liability lines */
  sign: number;
  groupCode: string | null;
  accountId: number | null;
  /** month key ("2025-04") -> signed rupee amount */
  values: Record<string, number>;
  /**
   * How this line combines the months of a quarter or year column, when it
   * differs from the rest of the statement. A cash flow is a flow statement
   * whose opening and closing cash lines are positions: three months of net
   * change add up, three opening balances do not.
   */
  columnAggregate?: "sum" | "first" | "last";
}

export interface StatementResult {
  months: FyMonth[];
  lines: StatementLine[];
  /** true when at least one account carries postings but no mapping */
  hasUnmapped: boolean;
  unmappedTotal: number;
  /** Consolidation only: what was removed as intercompany, and by how much the two sides disagreed. */
  eliminations?: {
    /** absolute value of the intercompany balances taken out, at the latest month */
    removed: number;
    /** what the two companies' books disagree by, at the latest month */
    difference: number;
  };
}

interface GroupRow {
  code: string;
  name: string;
  sort_order: number;
  is_subtotal: boolean;
  subtotal_of: string[] | null;
  sign: number;
}

const monthKey = (iso: string) => iso.slice(0, 7);

function emptyValues(months: FyMonth[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of months) out[m.key] = 0;
  return out;
}

async function loadGroups(entityId: number, statement: "pnl" | "bs" | "cf"): Promise<GroupRow[]> {
  return query<GroupRow>(
    `select code, name, sort_order, is_subtotal, subtotal_of, sign
       from report_groups
      where entity_id = $1 and statement = $2
      order by sort_order`,
    [entityId, statement],
  );
}

/* ============================================================
   Profit & Loss
   ============================================================ */

export async function buildProfitAndLoss(opts: {
  entity: Entity;
  fyStartYear: number;
  verticalId?: number | null;
  /** include the ledger accounts beneath each group heading */
  detail?: boolean;
}): Promise<StatementResult> {
  const { entity, fyStartYear, verticalId = null, detail = true } = opts;
  const months = fyMonths(fyStartYear);
  const { start, end } = fyBounds(fyStartYear);

  const [groups, rows] = await Promise.all([
    loadGroups(entity.id, "pnl"),
    query<{
      month_key: string;
      group_code: string | null;
      account_id: number;
      account_name: string;
      account_sort: number;
      amount: number;
    }>(
      `select to_char(g.txn_date, 'YYYY-MM') as month_key,
              a.group_code,
              min(a.id)           as account_id,
              a.name              as account_name,
              min(a.sort_order)   as account_sort,
              sum(g.credit - g.debit) as amount
         from gl_entries g
         join accounts a on a.id = g.account_id
        where g.entity_id = any($1::int[])
          and g.txn_date between $2 and $3
          and a.statement = 'pnl'
          -- Intercompany accounts survive in a company's own statement and are
          -- removed only when the group is consolidated.
          and not ($5::boolean and a.is_intercompany)
          and ($4::int is null or g.vertical_id = $4)
          ${verticalScope("$6", "g.vertical_id")}
        group by 1, 2, 4`,
      [entity.memberIds, start, end, verticalId, entity.consolidates, entity.verticalIds],
    ),
  ]);

  return assemble(months, groups, rows, detail);
}

/* ============================================================
   Balance Sheet
   ============================================================ */

export async function buildBalanceSheet(opts: {
  entity: Entity;
  fyStartYear: number;
  detail?: boolean;
}): Promise<StatementResult> {
  const { entity, fyStartYear, detail = true } = opts;
  const months = fyMonths(fyStartYear);
  const { start, end } = fyBounds(fyStartYear);
  const ids = entity.memberIds;
  const consolidating = entity.consolidates;

  const [groups, opening, movements, pnlMovements, interco, openingNonBs] = await Promise.all([
    loadGroups(entity.id, "bs"),
    // Opening position: the prior-year closing trial balance, plus any ledger
    // movement dated before this financial year.
    query<{ account_id: number; account_name: string; account_sort: number; group_code: string | null; amount: number }>(
      `select min(a.id) as account_id, a.name as account_name, min(a.sort_order) as account_sort,
              a.group_code, sum(x.amount) as amount
         from (
           select account_id, (debit - credit) as amount
             from opening_balances where entity_id = any($1::int[]) and as_of < $2
           union all
           select account_id, (debit - credit) as amount
             from gl_entries where entity_id = any($1::int[]) and txn_date < $2
         ) x
         join accounts a on a.id = x.account_id
        where a.statement in ('bs','none') and not ($3::boolean and a.is_intercompany)
        group by a.name, a.group_code`,
      [ids, start, consolidating],
    ),
    query<{ month_key: string; account_id: number; account_name: string; account_sort: number; group_code: string | null; amount: number }>(
      `select to_char(g.txn_date, 'YYYY-MM') as month_key,
              min(a.id) as account_id, a.name as account_name, min(a.sort_order) as account_sort,
              a.group_code, sum(g.debit - g.credit) as amount
         from gl_entries g
         join accounts a on a.id = g.account_id
        where g.entity_id = any($1::int[]) and g.txn_date between $2 and $3
          and a.statement in ('bs','none') and not ($4::boolean and a.is_intercompany)
        group by 1, a.name, a.group_code`,
      [ids, start, end, consolidating],
    ),
    // Current-year profit has to land in reserves or the balance sheet will not
    // tie - Zoho keeps it in the P&L until year end.
    query<{ month_key: string; amount: number }>(
      `select to_char(g.txn_date, 'YYYY-MM') as month_key,
              sum(g.credit - g.debit) as amount
         from gl_entries g
         join accounts a on a.id = g.account_id
        where g.entity_id = any($1::int[]) and g.txn_date between $2 and $3
          and a.statement = 'pnl' and not ($4::boolean and a.is_intercompany)
        group by 1`,
      [ids, start, end, consolidating],
    ),
    // Intercompany balances taken out above, so the consolidation can say what
    // it removed and carry the difference the two sets of books disagree by.
    consolidating
      ? query<{ account_id: number; month_key: string; amount: number }>(
          `select x.account_id, to_char(x.d, 'YYYY-MM') as month_key, sum(x.amount) as amount
             from (
               select o.account_id, o.as_of as d, (o.debit - o.credit) as amount
                 from opening_balances o
                where o.entity_id = any($1::int[])
               union all
               select g.account_id, g.txn_date as d, (g.debit - g.credit) as amount
                 from gl_entries g
                where g.entity_id = any($1::int[])
             ) x
             join accounts a on a.id = x.account_id
            where a.is_intercompany and x.d <= $2
            group by 1, 2`,
          [ids, end],
        )
      : Promise.resolve([]),
    /**
     * Opening balances that are not on balance-sheet accounts.
     *
     * A closing trial balance carries the year's income and expense accounts
     * too, and they are as much a part of the opening position as the assets
     * are - the trial balance only balances with them in it. Read as P&L they
     * would restate this year's profit; ignored, they leave the opening balance
     * sheet short by exactly their total, which is what made RBJV's statement
     * fail to tie by Rs 91,770. They are prior-year results, so they belong in
     * opening reserves. Anything still unclassified is counted as missing
     * rather than absorbed, so the page can say so.
     */
    query<{ statement: string; amount: number }>(
      `select a.statement::text as statement, sum(o.debit - o.credit) as amount
         from opening_balances o
         join accounts a on a.id = o.account_id
        where o.entity_id = any($1::int[]) and o.as_of < $2
          and a.statement = 'pnl'
          and not ($3::boolean and a.is_intercompany)
        group by 1`,
      [ids, start, consolidating],
    ),
  ]);

  const broughtForward = openingNonBs.reduce((sum, r) => sum + Number(r.amount), 0);

  // Build cumulative account balances per month end.
  const accounts = new Map<
    number,
    { name: string; sort: number; groupCode: string | null; values: Record<string, number> }
  >();

  const ensure = (id: number, name: string, sort: number, groupCode: string | null) => {
    let entry = accounts.get(id);
    if (!entry) {
      entry = { name, sort, groupCode, values: emptyValues(months) };
      accounts.set(id, entry);
    }
    return entry;
  };

  const openingByAccount = new Map<number, number>();
  for (const row of opening) {
    ensure(row.account_id, row.account_name, row.account_sort, row.group_code);
    openingByAccount.set(row.account_id, (openingByAccount.get(row.account_id) ?? 0) + row.amount);
  }

  const monthlyByAccount = new Map<number, Record<string, number>>();
  for (const row of movements) {
    const entry = ensure(row.account_id, row.account_name, row.account_sort, row.group_code);
    let byMonth = monthlyByAccount.get(row.account_id);
    if (!byMonth) {
      byMonth = {};
      monthlyByAccount.set(row.account_id, byMonth);
    }
    byMonth[row.month_key] = (byMonth[row.month_key] ?? 0) + row.amount;
    void entry;
  }

  for (const [id, entry] of accounts) {
    let running = openingByAccount.get(id) ?? 0;
    const byMonth = monthlyByAccount.get(id) ?? {};
    for (const m of months) {
      running += byMonth[m.key] ?? 0;
      entry.values[m.key] = running;
    }
  }

  // Retained profit for the year to date, expressed the balance-sheet way
  // (credit balance -> negative under debit-credit).
  const profitLine: Record<string, number> = emptyValues(months);
  let cumulativeProfit = 0;
  const profitByMonth = new Map(pnlMovements.map((r) => [r.month_key, r.amount]));
  for (const m of months) {
    cumulativeProfit += profitByMonth.get(m.key) ?? 0;
    profitLine[m.key] = -cumulativeProfit;
  }

  const rows = [...accounts.entries()].flatMap(([id, entry]) =>
    months.map((m) => ({
      month_key: m.key,
      group_code: entry.groupCode,
      account_id: id,
      account_name: entry.name,
      account_sort: entry.sort,
      amount: entry.values[m.key],
    })),
  );

  /**
   * The intercompany plug.
   *
   * Removing both sides of an intercompany balance leaves the group balance
   * sheet out by whatever the two companies disagree by - here RBJV shows less
   * owed to it than Akshayam shows owing. That difference is real and someone
   * has to reconcile it, so it is carried as its own line rather than smeared
   * across the statement or quietly forced into reserves.
   */
  const elimination: Record<string, number> = emptyValues(months);
  let removed = 0;
  let difference = 0;

  if (consolidating && interco.length > 0) {
    const balances = new Map<number, number>();
    const byAccountMonth = new Map<number, Record<string, number>>();

    for (const row of interco) {
      if (row.month_key < months[0].key) {
        // Anything before the year opens is part of the opening position.
        balances.set(row.account_id, (balances.get(row.account_id) ?? 0) + row.amount);
        continue;
      }
      let byMonth = byAccountMonth.get(row.account_id);
      if (!byMonth) {
        byMonth = {};
        byAccountMonth.set(row.account_id, byMonth);
      }
      byMonth[row.month_key] = (byMonth[row.month_key] ?? 0) + row.amount;
      if (!balances.has(row.account_id)) balances.set(row.account_id, 0);
    }

    const running = new Map(balances);
    for (const m of months) {
      let net = 0;
      for (const [id, opening] of balances) {
        const carried = (running.get(id) ?? opening) + (byAccountMonth.get(id)?.[m.key] ?? 0);
        running.set(id, carried);
        net += carried;
      }
      // Books balance, so kept accounts sum to -net once the intercompany ones
      // are taken out. Putting `net` back as its own line restores the equality
      // without disturbing any real balance.
      elimination[m.key] = net;
    }

    const closing = [...running.values()];
    removed = closing.reduce((sum, v) => sum + Math.abs(v), 0);
    difference = Math.abs(closing.reduce((sum, v) => sum + v, 0));
  }

  const result = assemble(months, groups, rows, detail, {
    absolute: true,
    unclassifiedGroup: "unclassified",
  });

  // Splice the profit-for-the-period line in under Reserves & Surplus, together
  // with any prior-year P&L balances the opening trial balance carried.
  const reservesIndex = result.lines.findIndex((l) => l.groupCode === "reserves" && l.level === 0);
  if (reservesIndex >= 0) {
    const reserves = result.lines[reservesIndex];
    const extra: StatementLine[] = [];

    if (Math.abs(broughtForward) > 0.005) {
      const carried = emptyValues(months);
      for (const m of months) carried[m.key] = broughtForward;
      for (const m of months) reserves.values[m.key] += broughtForward;
      extra.push({
        key: "brought_forward",
        name: "Prior-year P&L balances brought forward",
        level: 1,
        isSubtotal: false,
        sign: -1,
        groupCode: "reserves",
        accountId: null,
        values: carried,
      });
    }

    for (const m of months) reserves.values[m.key] += profitLine[m.key];
    extra.push({
      key: "profit_for_period",
      name: "Profit for the period",
      level: 1,
      isSubtotal: false,
      sign: -1,
      groupCode: "reserves",
      accountId: null,
      values: profitLine,
    });

    result.lines.splice(reservesIndex + 1, 0, ...extra);
    recomputeSubtotals(result.lines, groups, months);
  }

  if (consolidating && months.some((m) => Math.abs(elimination[m.key]) > 0.005)) {
    const target = result.lines.findIndex((l) => l.groupCode === "other_liab" && l.level === 0);
    const host =
      target >= 0
        ? result.lines[target]
        : ({
            key: "other_liab",
            name: "Other Liabilities & Provisions",
            level: 0,
            isSubtotal: false,
            sign: -1,
            groupCode: "other_liab",
            accountId: null,
            values: emptyValues(months),
          } satisfies StatementLine);

    if (target < 0) {
      // No other liabilities at all in this period: put the heading where it
      // belongs, immediately above the total it feeds, not at the end.
      const total = result.lines.findIndex((l) => l.groupCode === "total_eq_liab");
      result.lines.splice(total >= 0 ? total : result.lines.length, 0, host);
    }
    for (const m of months) host.values[m.key] += elimination[m.key];

    const at = result.lines.indexOf(host);
    result.lines.splice(at + 1, 0, {
      key: "intercompany_difference",
      name: "Unreconciled intercompany difference",
      level: 1,
      isSubtotal: false,
      sign: -1,
      groupCode: "other_liab",
      accountId: null,
      values: elimination,
    });
    recomputeSubtotals(result.lines, groups, months);
  }

  // assemble() totals unmapped activity across every month, which is right for
  // the P&L - twelve months of trading add up. A balance sheet row is the same
  // balance restated each month end, so summing it counts the same money twelve
  // times. What is unclassified is what stands there at the close.
  const unclassified = result.lines.find((l) => l.groupCode === "unclassified" && l.level === 0);
  if (unclassified) {
    const closing = Math.abs(unclassified.values[months[months.length - 1].key] ?? 0);
    result.unmappedTotal = closing;
    result.hasUnmapped = closing > 0.005;
  }

  return { ...result, eliminations: consolidating ? { removed, difference } : undefined };
}

/* ============================================================
   Cash Flow
   ============================================================ */

/**
 * Which cash-flow line each account's movement belongs on.
 *
 * The buckets partition the chart of accounts, which is what makes the
 * statement tie without a plug: cash movement is minus the movement on
 * everything else, so as long as every non-cash account lands somewhere, the
 * sections add back to the change in the bank balance. An account nobody has
 * categorised gets its own line rather than being folded into working capital,
 * where a wrong guess would be invisible.
 */
const CF_BUCKET = `case
        when $4::boolean and a.is_intercompany then 'cf_interco'
        else case a.cf_category
          when 'pnl'              then 'pbt_cf'
          when 'non_cash_addback' then 'non_cash'
          when 'wc_operating'     then 'wc_changes'
          when 'tax'              then 'tax_paid'
          when 'investing'        then 'investing'
          when 'financing'        then 'financing'
          else 'cf_unclassified' end
      end`;

export interface CashFlowResult extends StatementResult {
  /**
   * The change in cash the statement arrives at, against the movement the bank
   * accounts actually show. They are derived independently, so a gap means an
   * account is missing from the chart - worth saying out loud rather than
   * discovering later.
   */
  reconciles: boolean;
  gap: number;
}

export async function buildCashFlow(opts: {
  entity: Entity;
  fyStartYear: number;
  detail?: boolean;
}): Promise<CashFlowResult> {
  const { entity, fyStartYear, detail = true } = opts;
  const months = fyMonths(fyStartYear);
  const { start, end } = fyBounds(fyStartYear);
  const ids = entity.memberIds;
  const consolidating = entity.isGroup;

  const [groups, rows, openingCashRow, cashMoves] = await Promise.all([
    loadGroups(entity.id, "cf"),
    // Every non-cash account, by month. The sign is flipped here once: a debit
    // movement on an asset is cash going out, so the statement reads in cash
    // terms from this point on and every line is a plain sum.
    query<{
      month_key: string;
      group_code: string | null;
      account_id: number;
      account_name: string;
      account_sort: number;
      amount: number;
    }>(
      `select to_char(g.txn_date, 'YYYY-MM') as month_key,
              ${CF_BUCKET} as group_code,
              min(a.id) as account_id, a.name as account_name, min(a.sort_order) as account_sort,
              -sum(g.debit - g.credit) as amount
         from gl_entries g
         join accounts a on a.id = g.account_id
        where g.entity_id = any($1::int[]) and g.txn_date between $2 and $3
          and coalesce(a.cf_category, '') <> 'cash'
        group by 1, 2, a.name`,
      [ids, start, end, consolidating],
    ),
    // Cash in hand and at bank when the year opened.
    queryOne<{ amount: number }>(
      `select coalesce(sum(x.amount), 0) as amount
         from (
           select account_id, (debit - credit) as amount
             from opening_balances where entity_id = any($1::int[]) and as_of < $2
           union all
           select account_id, (debit - credit) as amount
             from gl_entries where entity_id = any($1::int[]) and txn_date < $2
         ) x
         join accounts a on a.id = x.account_id
        where a.cf_category = 'cash'`,
      [ids, start],
    ),
    query<{ month_key: string; amount: number }>(
      `select to_char(g.txn_date, 'YYYY-MM') as month_key, sum(g.debit - g.credit) as amount
         from gl_entries g
         join accounts a on a.id = g.account_id
        where g.entity_id = any($1::int[]) and g.txn_date between $2 and $3
          and a.cf_category = 'cash'
        group by 1`,
      [ids, start, end],
    ),
  ]);

  const result = assemble(months, groups, rows, detail);

  // Opening cash for a month is the closing cash of the one before it, so the
  // quarter columns can take the first month's opening and the last month's
  // close and still describe a real position.
  const openingCash = emptyValues(months);
  const closingCash = emptyValues(months);
  const netChange = result.lines.find((l) => l.groupCode === "net_change");

  let running = Number(openingCashRow?.amount ?? 0);
  for (const m of months) {
    openingCash[m.key] = running;
    running += netChange?.values[m.key] ?? 0;
    closingCash[m.key] = running;
  }

  const place = (code: string, name: string, values: Record<string, number>, aggregate: "first" | "last") => {
    const existing = result.lines.find((l) => l.groupCode === code && l.level === 0);
    if (existing) {
      for (const m of months) existing.values[m.key] = values[m.key];
      existing.columnAggregate = aggregate;
      return;
    }
    const group = groups.find((g) => g.code === code);
    const line: StatementLine = {
      key: code,
      name: group?.name ?? name,
      level: 0,
      isSubtotal: group?.is_subtotal ?? false,
      sign: 1,
      groupCode: code,
      accountId: null,
      values: { ...values },
      columnAggregate: aggregate,
    };
    // Keep the seeded order: insert ahead of the first line that sorts after it.
    const order = group?.sort_order ?? 999;
    const at = result.lines.findIndex(
      (l) => (groups.find((g) => g.code === l.groupCode)?.sort_order ?? 999) > order,
    );
    result.lines.splice(at < 0 ? result.lines.length : at, 0, line);
  };

  place("opening_cash", "Cash at Beginning of Period", openingCash, "first");
  place("closing_cash", "Cash at End of Period", closingCash, "last");

  // Independent check: what the bank accounts actually did.
  const actual = cashMoves.reduce((sum, r) => sum + Number(r.amount), 0);
  const stated = months.reduce((sum, m) => sum + (netChange?.values[m.key] ?? 0), 0);
  const gap = stated - actual;

  return { ...result, reconciles: Math.abs(gap) < 1, gap };
}

/* ============================================================
   Shared assembly
   ============================================================ */

interface FlatRow {
  month_key: string;
  group_code: string | null;
  account_id: number;
  account_name: string;
  account_sort: number;
  amount: number;
}

function assemble(
  months: FyMonth[],
  groups: GroupRow[],
  rows: FlatRow[],
  detail: boolean,
  opts: { absolute?: boolean; unclassifiedGroup?: string } = {},
): StatementResult {
  const validMonths = new Set(months.map((m) => m.key));
  const knownGroups = new Set(groups.map((g) => g.code));
  const fallback =
    opts.unclassifiedGroup && knownGroups.has(opts.unclassifiedGroup)
      ? opts.unclassifiedGroup
      : null;

  // account id -> its line, and group code -> accounts under it
  const accountLines = new Map<number, StatementLine>();
  const byGroup = new Map<string, Set<number>>();
  let unmappedTotal = 0;
  let hasUnmapped = false;

  for (const row of rows) {
    if (!validMonths.has(row.month_key)) continue;

    let group = row.group_code && knownGroups.has(row.group_code) ? row.group_code : null;
    if (!group) {
      hasUnmapped = true;
      unmappedTotal += Math.abs(row.amount);
      // Shown under "Unclassified" where the statement has such a line, so the
      // total still ties and the reader can see what has not been placed.
      // Without one there is nowhere to put it and it stays out.
      if (!fallback) continue;
      group = fallback;
    }

    let line = accountLines.get(row.account_id);
    if (!line) {
      line = {
        key: `acct:${row.account_id}`,
        name: row.account_name,
        level: 1,
        isSubtotal: false,
        sign: groups.find((g) => g.code === group)?.sign ?? 1,
        groupCode: group,
        accountId: row.account_id,
        values: emptyValues(months),
      };
      accountLines.set(row.account_id, line);
      if (!byGroup.has(group)) byGroup.set(group, new Set());
      byGroup.get(group)!.add(row.account_id);
    }
    line.values[row.month_key] += row.amount;
  }

  // Drop accounts with no activity at all - an empty ledger account is noise.
  for (const [id, line] of accountLines) {
    const anyValue = months.some((m) => Math.abs(line.values[m.key]) > 0.005);
    if (!anyValue) {
      accountLines.delete(id);
      if (line.groupCode) byGroup.get(line.groupCode)?.delete(id);
    }
  }

  const lines: StatementLine[] = [];

  for (const group of groups) {
    const groupLine: StatementLine = {
      key: group.code,
      name: group.name,
      level: 0,
      isSubtotal: group.is_subtotal,
      sign: group.sign,
      groupCode: group.code,
      accountId: null,
      values: emptyValues(months),
    };

    if (!group.is_subtotal) {
      const ids = byGroup.get(group.code) ?? new Set<number>();
      const children = [...ids]
        .map((id) => accountLines.get(id)!)
        .sort((a, b) => a.name.localeCompare(b.name));

      for (const child of children) {
        for (const m of months) groupLine.values[m.key] += child.values[m.key];
      }

      // A group with nothing in it is omitted entirely rather than shown as zero.
      const anyValue = months.some((m) => Math.abs(groupLine.values[m.key]) > 0.005);
      if (!anyValue && children.length === 0) continue;

      lines.push(groupLine);
      if (detail) lines.push(...children);
      continue;
    }

    lines.push(groupLine);
  }

  recomputeSubtotals(lines, groups, months);

  if (opts.absolute) {
    // Balance-sheet lines are point-in-time, so a zero opening month is real
    // information; nothing further to do here.
  }

  return { months, lines, hasUnmapped, unmappedTotal };
}

/** Fill in every subtotal line by summing the groups it references, in order. */
function recomputeSubtotals(lines: StatementLine[], groups: GroupRow[], months: FyMonth[]) {
  const byCode = new Map<string, StatementLine>();
  for (const line of lines) {
    if (line.level === 0 && line.groupCode) byCode.set(line.groupCode, line);
  }

  for (const group of groups) {
    if (!group.is_subtotal || !group.subtotal_of) continue;
    const target = byCode.get(group.code);
    if (!target) continue;

    for (const m of months) target.values[m.key] = 0;
    for (const sourceCode of group.subtotal_of) {
      const source = byCode.get(sourceCode);
      if (!source) continue;
      for (const m of months) target.values[m.key] += source.values[m.key];
    }
  }
}

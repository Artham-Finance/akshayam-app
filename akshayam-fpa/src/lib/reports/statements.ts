import { query, queryOne } from "@/lib/db";
import { verticalScope, type Entity } from "@/lib/entity";
import { fyBounds, fyMonths } from "@/lib/period";
import {
  assemble,
  composeBalanceSheet,
  emptyValues,
  type BsMovementRow,
  type BsOpeningRow,
  type GroupRow,
  type StatementLine,
  type StatementResult,
} from "@/lib/reports/compose";

// The composition half lives in ./compose, which knows nothing about the
// database; these are re-exported so callers keep one import.
export {
  composeBalanceSheet,
  type StatementLine,
  type StatementResult,
} from "@/lib/reports/compose";

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
    query<BsOpeningRow>(
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
    query<BsMovementRow>(
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
               -- Same date window as the opening query above. A trial balance
               -- dated inside the year is not an opening position, and taking
               -- it here while the rest of the statement leaves it out would
               -- eliminate a balance that was never brought in.
               select o.account_id, o.as_of as d, (o.debit - o.credit) as amount
                 from opening_balances o
                where o.entity_id = any($1::int[]) and o.as_of < $3
               union all
               select g.account_id, g.txn_date as d, (g.debit - g.credit) as amount
                 from gl_entries g
                where g.entity_id = any($1::int[])
             ) x
             join accounts a on a.id = x.account_id
            where a.is_intercompany and x.d <= $2
            group by 1, 2`,
          [ids, end, start],
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
     *
     * Ledger movement dated before the year opens is prior-year trading for
     * exactly the same reason, and a general ledger covering more than one
     * financial year carries it. The balance-sheet accounts of that movement
     * are already in the opening query above; without its income and expense
     * side the statement would be out by the prior year's profit.
     */
    query<{ statement: string; amount: number }>(
      `select 'pnl' as statement, sum(x.amount) as amount
         from (
           select o.account_id, (o.debit - o.credit) as amount
             from opening_balances o where o.entity_id = any($1::int[]) and o.as_of < $2
           union all
           select g.account_id, (g.debit - g.credit) as amount
             from gl_entries g where g.entity_id = any($1::int[]) and g.txn_date < $2
         ) x
         join accounts a on a.id = x.account_id
        where a.statement = 'pnl'
          and not ($3::boolean and a.is_intercompany)`,
      [ids, start, consolidating],
    ),
  ]);

  return composeBalanceSheet({
    months,
    groups,
    opening,
    movements,
    pnlMovements,
    interco,
    openingNonBs,
    consolidating,
    detail,
  });
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


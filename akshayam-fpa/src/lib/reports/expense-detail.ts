import { query } from "@/lib/db";
import type { Entity } from "@/lib/entity";
import type { FyMonth } from "@/lib/period";

/**
 * The breakdown behind "Other expenses", budget against actual.
 *
 * The statement carries one figure a month; this is what it is made of. It is
 * the line the founder reads first, and the one where a variance is usually a
 * story rather than a rounding - so it gets its own table, and a place to
 * write the story down.
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
  sortOrder: number;
  budget: number;
  /** the bills recorded against this line, newest first */
  entries: ExpenseEntry[];
  /** the sum of them */
  actual: number;
  variance: number;
}

export interface ExpenseDetailResult {
  /** true once a breakdown has been loaded for this entity and year */
  hasDetail: boolean;
  lines: ExpenseDetailLine[];
  totals: { budget: number; actual: number; variance: number };
  /**
   * The same "Other expenses" the statement above shows, so the entered total
   * can be seen to agree with the ledger - or seen not to, which is the more
   * useful case.
   */
  statement: { budget: number; ledger: number };
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
}): Promise<ExpenseDetailResult> {
  const { entity, fyStartYear, periodMonths } = opts;
  const monthKeys = periodMonths.map((m) => `${m.key}-01`);
  const start = periodMonths[0].start;
  const end = periodMonths[periodMonths.length - 1].end;

  const [budgetRows, entryRows, ledgerRows, statementRows, vendorRows] = await Promise.all([
    query<{ head: string; label: string; sort_order: number; amount: number }>(
      `select head, label, min(sort_order) as sort_order, sum(amount) as amount
         from expense_budget_lines
        where entity_id = $1 and fy_start_year = $2 and month = any($3::date[])
        group by head, label
        order by min(sort_order)`,
      [entity.id, fyStartYear, monthKeys],
    ),
    query<{
      id: number;
      head: string;
      label: string;
      spent_on: string;
      vendor: string | null;
      amount: number;
      remark: string | null;
    }>(
      `select id, head, label, spent_on::text, vendor, amount, remark
         from expense_entries
        where entity_id = $1 and fy_start_year = $2 and month = any($3::date[])
        order by spent_on desc, id desc`,
      [entity.id, fyStartYear, monthKeys],
    ),
    // Debit less credit, so a cost is positive - the direction the breakdown
    // is read in. Shown only as the control total at the foot.
    query<{ amount: number }>(
      `select coalesce(sum(g.debit - g.credit), 0)::numeric as amount
         from gl_entries g
         join accounts a on a.id = g.account_id
        where g.entity_id = any($1::int[]) and g.txn_date between $2 and $3
          and a.statement = 'pnl' and a.group_code = any($4::text[])
          and not ($5::boolean and a.is_intercompany)`,
      [entity.memberIds, start, end, POOL_GROUPS, entity.consolidates],
    ),
    query<{ amount: number }>(
      `select coalesce(sum(amount), 0)::numeric as amount
         from budget_pnl
        where entity_id = $1 and fy_start_year = $2 and month = any($3::date[])
          and group_code = 'overheads'`,
      [entity.id, fyStartYear, monthKeys],
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
  ]);

  const entriesByLine = new Map<string, ExpenseEntry[]>();
  for (const row of entryRows) {
    const key = `${row.head}|${row.label}`;
    const list = entriesByLine.get(key) ?? [];
    list.push({
      id: row.id,
      spentOn: row.spent_on,
      vendor: row.vendor,
      amount: Number(row.amount),
      remark: row.remark,
    });
    entriesByLine.set(key, list);
  }

  const headCounts = new Map<string, number>();
  for (const row of budgetRows) {
    headCounts.set(row.head, (headCounts.get(row.head) ?? 0) + 1);
  }

  const lines: ExpenseDetailLine[] = budgetRows.map((row) => {
    const budget = Number(row.amount);
    const entries = entriesByLine.get(`${row.head}|${row.label}`) ?? [];
    const actual = entries.reduce((s, e) => s + e.amount, 0);
    return {
      head: row.head,
      label: row.label,
      isHeadOnly: headCounts.get(row.head) === 1 && row.head === row.label,
      sortOrder: Number(row.sort_order),
      budget,
      entries,
      actual,
      // A cost under budget is a favourable variance, so budget less actual.
      variance: budget - actual,
    };
  });

  const sum = (pick: (l: ExpenseDetailLine) => number) =>
    lines.reduce((s, l) => s + pick(l), 0);

  return {
    hasDetail: budgetRows.length > 0,
    lines,
    totals: {
      budget: sum((l) => l.budget),
      actual: sum((l) => l.actual),
      variance: sum((l) => l.variance),
    },
    statement: {
      budget: Number(statementRows[0]?.amount ?? 0),
      ledger: Number(ledgerRows[0]?.amount ?? 0),
    },
    vendors: vendorRows.map((v) => v.vendor),
  };
}

import { query } from "@/lib/db";
import { getVerticalsInScope, type Entity } from "@/lib/entity";
import { ROWS, scorecardRowCodeFor } from "@/lib/reports/scorecard";
import { revisedBudgetForVertical } from "@/lib/reports/scorecard-budget";
import { cmrgaCollectedByVertical } from "@/lib/reports/cmrga-receivables";
import { addDays, isLocked, ratingVsBudget, todayIst, type WeeklyMeasure } from "@/lib/weekly";

/**
 * The MAK meeting screen's figures, for one week and one measure.
 *
 * Each vertical's head commits an amount before the week begins, customer by
 * customer. Two ratings, both on the Vertical Performance Scorecard's own bands
 * (4 at 100% of budget or more, then over 80%, 60%, 40%): one on what was
 * committed against the weekly budget - how ambitious the head's undertaking
 * is - and one on what was actually achieved against that same budget. Nothing
 * here is stored but the commitment itself - the budget is the revised
 * quarterly budget spread over the week's days, and the actual is read from the
 * ledger, the payments and the invoices every time.
 *
 * The three measures:
 *  - Revenue: the ledger's revenue for the vertical in the week (the figure the
 *    Revenue tab's Actual is made of), against the weekly budget.
 *  - Collection: fee receipts allocated to the vertical in the week, against
 *    108% of the weekly revenue budget.
 *
 * Receivables are not a measure of their own: they are what a collection is
 * committed out of. On the Collection measure each vertical carries the open
 * receivable by customer (the latest AR snapshot on or before the week), and a
 * collection can be committed only against a customer who owes.
 */

export interface WeeklyLine {
  customer: string;
  /** committed for this customer */
  amount: number;
  /** what the customer actually came to in the week - billed for revenue, received otherwise */
  actual: number;
  /** collection only: what the customer owes, from the receivables snapshot (null if not on it) */
  outstanding: number | null;
}

/** One entry of the ledger figure the week's actual revenue is made of (revenue measure only). */
export interface ActualEntry {
  customer: string;
  date: string;
  /** where the amount comes from: the ledger itself, an OSB invoice, or revenue transferred away */
  source: "Ledger" | "OSB" | "Transferred";
  /** the transaction's type and number, e.g. "Invoice INV-0042" */
  ref: string;
  amount: number;
}

/** A customer who owes the vertical money, and so a customer a collection can be committed against. */
export interface ReceivableCustomer {
  customer: string;
  outstanding: number;
  /** of which past its due date at the snapshot */
  overdue: number;
  /** of which a CMRGA receivable shifted to this vertical */
  cmrga: number;
}

export interface WeeklyRow {
  verticalId: number;
  /** the scorecard row this vertical rolls into */
  rowCode: string;
  label: string;
  budget: number | null;
  committed: number;
  hasCommitment: boolean;
  lines: WeeklyLine[];
  actual: number;
  /** collection only: of `actual`, what came in on receivables shifted to this vertical from the discontinued CMRGA */
  fromCmrga: number | null;
  /** revenue only: the entries that add up to `actual`, by customer then date */
  breakup: ActualEntry[];
  /** actual as a fraction of the commitment, or null where nothing was committed */
  pctOfCommitment: number | null;
  /** the commitment rated against the weekly budget - what the head undertook */
  commitmentRating: number | null;
  /** the actual rated against the weekly budget */
  actualRating: number | null;
  achieved: "yes" | "partly" | "no" | null;
  remarks: string | null;
  meetingDate: string | null;
  enteredOn: string | null;
  /** the amounts can no longer be changed (the outcome still can) */
  locked: boolean;
  reopenedOn: string | null;
  /** customers a line can be picked from (invoiced customers, for revenue) */
  customers: string[];
  /** collection only: the customers who owe, with what they owe - the picker for a collection */
  receivableCustomers: ReceivableCustomer[];
  /** collection only: the vertical's total open receivable, and the overdue part of it */
  receivableTotal: number;
  receivableOverdue: number;
  /** collection only: of the total, the part that is CMRGA's receivables shifted to this vertical */
  receivableCmrga: number;
}

export interface WeeklyRatingsResult {
  measure: WeeklyMeasure;
  weekStart: string;
  weekEnd: string;
  today: string;
  /** the receivables snapshot the Collection measure reads, or null */
  arAsOf: string | null;
  rows: WeeklyRow[];
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

const TXN_LABEL: Record<string, string> = {
  invoice: "Invoice",
  creditnote: "Credit note",
  journal: "Journal",
};

interface CommitRow {
  id: number;
  vertical_id: number;
  meeting_date: string;
  entered_on: string;
  reopened_on: string | null;
  achieved: "yes" | "partly" | "no" | null;
  remarks: string | null;
}

export async function buildWeeklyRatings(opts: {
  entity: Entity;
  measure: WeeklyMeasure;
  weekEnd: string;
}): Promise<WeeklyRatingsResult> {
  const { entity, measure, weekEnd } = opts;
  const weekStart = addDays(weekEnd, -6);
  const today = todayIst();

  const scoped = await getVerticalsInScope(entity);
  const candidates = scoped
    .map((v) => ({ v, rowCode: scorecardRowCodeFor(v.code) }))
    .filter((c): c is { v: (typeof scoped)[number]; rowCode: string } => c.rowCode !== null);
  const ids = candidates.map((c) => c.v.id);

  const verticalMeta =
    ids.length === 0
      ? []
      : await query<{ id: number; slug: string }>(
          `select v.id, e.slug from verticals v join entities e on e.id = v.entity_id
            where v.id = any($1::int[])`,
          [ids],
        );
  const slugOf = new Map(verticalMeta.map((m) => [m.id, m.slug]));

  const commits =
    ids.length === 0
      ? []
      : await query<CommitRow>(
          `select id, vertical_id, meeting_date::text, entered_on::text, reopened_on::text,
                  achieved, remarks
             from weekly_commitments
            where vertical_id = any($1::int[]) and week_end = $2 and measure = $3`,
          [ids, weekEnd, measure],
        );
  const commitByVertical = new Map(commits.map((c) => [c.vertical_id, c]));
  const lineRows =
    commits.length === 0
      ? []
      : await query<{ commitment_id: number; customer_name: string; amount: number }>(
          `select commitment_id, customer_name, amount::float8 as amount
             from weekly_commitment_lines
            where commitment_id = any($1::int[]) order by id`,
          [commits.map((c) => c.id)],
        );

  const memberIds = entity.memberIds;
  const window = [memberIds, weekStart, weekEnd, ids] as const;

  // ---- actuals, by vertical ----
  const actualByVertical = new Map<number, number>();
  const bump = (rows: { vertical_id: number | null; v: number }[]) => {
    for (const r of rows) {
      if (r.vertical_id === null) continue;
      actualByVertical.set(r.vertical_id, (actualByVertical.get(r.vertical_id) ?? 0) + Number(r.v));
    }
  };
  if (ids.length > 0 && measure === "revenue") {
    const [gl, osb, transferred] = await Promise.all([
      query<{ vertical_id: number | null; v: number }>(
        `select g.vertical_id, sum(g.credit - g.debit)::numeric as v
           from gl_entries g join accounts a on a.id = g.account_id
          where g.entity_id = any($1::int[]) and g.txn_date between $2 and $3
            and a.statement = 'pnl' and a.group_code = 'revenue'
            and g.vertical_id = any($4::int[])
          group by 1`,
        [...window],
      ),
      query<{ vertical_id: number | null; v: number }>(
        `select i.vertical_id, sum(i.amount_base)::numeric as v
           from invoice_lines i
          where i.entity_id = any($1::int[]) and i.is_osb
            and i.invoice_date between $2 and $3 and i.vertical_id = any($4::int[])
          group by 1`,
        [...window],
      ),
      query<{ vertical_id: number | null; v: number }>(
        `select t.vertical_id, -sum(t.amount)::numeric as v
           from revenue_transfer_entries t
          where t.entity_id = any($1::int[]) and t.entity_id in (select id from entities where slug = 'akshayam') and t.invoice_date between $2 and $3
            and t.vertical_id = any($4::int[])
          group by 1`,
        [...window],
      ),
    ]);
    bump(gl);
    bump(osb);
    bump(transferred);
  } else if (ids.length > 0 && measure === "collection") {
    bump(
      await query<{ vertical_id: number | null; v: number }>(
        `select a.vertical_id,
                sum(case when a.is_reimbursement then 0 else a.amount_base end)::numeric as v
           from payment_allocations a join payments p on p.id = a.payment_id
          where a.entity_id = any($1::int[]) and p.payment_date between $2 and $3
            and a.vertical_id = any($4::int[])
          group by 1`,
        [...window],
      ),
    );
  }

  // ---- collection: how much of the actual is from CMRGA's shifted receivables (already in it) ----
  const cmrgaByVertical =
    ids.length > 0 && measure === "collection"
      ? await cmrgaCollectedByVertical(entity, { start: weekStart, end: weekEnd })
      : new Map<number, number>();

  // ---- revenue actual, entry by entry: the same three sources as above, so it adds up to it ----
  const breakupByVertical = new Map<number, ActualEntry[]>();
  if (ids.length > 0 && measure === "revenue") {
    const none = "(no customer on the entry)";
    const [gl, osb, transferred] = await Promise.all([
      query<{ vertical_id: number; customer: string; d: string; kind: string | null; num: string | null; v: number }>(
        // The ledger rarely names the customer: an invoice's is on the invoice, a credit note's is its description.
        `select g.vertical_id,
                coalesce(nullif(btrim(g.contact_name), ''), c.cust,
                         case when g.txn_type ilike 'credit%' then nullif(btrim(g.description), '') end, $5) as customer,
                g.txn_date::text as d, g.txn_type as kind, g.txn_number as num,
                sum(g.credit - g.debit)::float8 as v
           from gl_entries g join accounts a on a.id = g.account_id
           left join (select entity_id, invoice_number, min(btrim(customer_name)) as cust
                        from invoice_lines where entity_id = any($1::int[]) group by 1, 2) c
             on c.entity_id = g.entity_id and c.invoice_number = g.txn_number
          where g.entity_id = any($1::int[]) and g.txn_date between $2 and $3
            and a.statement = 'pnl' and a.group_code = 'revenue'
            and g.vertical_id = any($4::int[])
          group by 1, 2, 3, 4, 5`,
        [...window, none],
      ),
      query<{ vertical_id: number; customer: string; d: string; num: string | null; v: number }>(
        `select i.vertical_id, coalesce(nullif(btrim(i.customer_name), ''), $5) as customer,
                i.invoice_date::text as d, i.invoice_number as num, sum(i.amount_base)::float8 as v
           from invoice_lines i
          where i.entity_id = any($1::int[]) and i.is_osb
            and i.invoice_date between $2 and $3 and i.vertical_id = any($4::int[])
          group by 1, 2, 3, 4`,
        [...window, none],
      ),
      query<{ vertical_id: number; customer: string; d: string; num: string | null; v: number }>(
        `select t.vertical_id, coalesce(nullif(btrim(t.customer_name), ''), $5) as customer,
                t.invoice_date::text as d, t.invoice_number as num, -sum(t.amount)::float8 as v
           from revenue_transfer_entries t
          where t.entity_id = any($1::int[]) and t.entity_id in (select id from entities where slug = 'akshayam') and t.invoice_date between $2 and $3
            and t.vertical_id = any($4::int[])
          group by 1, 2, 3, 4`,
        [...window, none],
      ),
    ]);
    const push = (verticalId: number, entry: ActualEntry) => {
      if (Math.abs(entry.amount) < 0.005) return;
      const list = breakupByVertical.get(verticalId) ?? [];
      list.push(entry);
      breakupByVertical.set(verticalId, list);
    };
    for (const r of gl) {
      push(r.vertical_id, {
        customer: r.customer,
        date: r.d,
        source: "Ledger",
        ref: [TXN_LABEL[(r.kind ?? "").toLowerCase()] ?? r.kind, r.num].filter(Boolean).join(" ") || "Journal",
        amount: Number(r.v),
      });
    }
    for (const r of osb) {
      push(r.vertical_id, { customer: r.customer, date: r.d, source: "OSB", ref: `Invoice ${r.num ?? ""}`.trim(), amount: Number(r.v) });
    }
    for (const r of transferred) {
      push(r.vertical_id, {
        customer: r.customer,
        date: r.d,
        source: "Transferred",
        ref: `Invoice ${r.num ?? ""}`.trim(),
        amount: Number(r.v),
      });
    }
    for (const list of breakupByVertical.values()) {
      const byCustomer = new Map<string, number>();
      for (const e of list) byCustomer.set(e.customer, (byCustomer.get(e.customer) ?? 0) + e.amount);
      // The customer with the most first, then by date within a customer.
      list.sort(
        (a, b) =>
          (byCustomer.get(b.customer) ?? 0) - (byCustomer.get(a.customer) ?? 0) ||
          a.customer.localeCompare(b.customer) ||
          a.date.localeCompare(b.date) ||
          a.ref.localeCompare(b.ref),
      );
    }
  }

  // ---- actuals, by customer - the figure beside each committed line ----
  const customerActual = new Map<string, number>(); // `${verticalId}|${customer}`
  if (ids.length > 0 && lineRows.length > 0) {
    const rows =
      measure === "revenue"
        ? await query<{ vertical_id: number; cust: string; v: number }>(
            `select vertical_id, lower(btrim(customer_name)) as cust, sum(amount_base)::numeric as v
               from invoice_lines
              where entity_id = any($1::int[]) and invoice_date between $2 and $3
                and vertical_id = any($4::int[]) and not is_reimbursement
              group by 1, 2`,
            [...window],
          )
        : await query<{ vertical_id: number; cust: string; v: number }>(
            `select a.vertical_id, lower(btrim(p.customer_name)) as cust,
                    sum(case when a.is_reimbursement then 0 else a.amount_base end)::numeric as v
               from payment_allocations a join payments p on p.id = a.payment_id
              where a.entity_id = any($1::int[]) and p.payment_date between $2 and $3
                and a.vertical_id = any($4::int[])
              group by 1, 2`,
            [...window],
          );
    for (const r of rows) customerActual.set(`${r.vertical_id}|${r.cust}`, Number(r.v));
  }

  // ---- customers a line can be picked from ----
  const customersByVertical = new Map<number, string[]>();
  if (ids.length > 0) {
    const since = addDays(weekEnd, -548);
    const picks = await query<{ vertical_id: number; customer_name: string }>(
      `select vertical_id, customer_name from (
         select vertical_id, btrim(customer_name) as customer_name from invoice_lines
          where vertical_id = any($1::int[]) and invoice_date >= $2 and customer_name is not null
         union
         select vertical_id, btrim(customer_name) from ar_open_items
          where vertical_id = any($1::int[]) and customer_name is not null
       ) x where customer_name <> ''
       group by 1, 2 order by 2`,
      [ids, since],
    );
    for (const p of picks) {
      const list = customersByVertical.get(p.vertical_id) ?? [];
      if (list.length < 800) list.push(p.customer_name);
      customersByVertical.set(p.vertical_id, list);
    }
  }

  // ---- receivables, by customer: what a collection is committed out of ----
  const receivablesByVertical = new Map<number, ReceivableCustomer[]>();
  let arAsOf: string | null = null;
  if (measure === "collection" && ids.length > 0) {
    // For each company, the latest snapshot on or before the week's end; failing
    // that, the earliest there is - the same rule the scorecard's ageing reads.
    const open = await query<{
      vertical_id: number;
      customer: string;
      outstanding: number;
      overdue: number;
      cmrga: number;
      as_of: string;
    }>(
      // A receivable shifted from the discontinued CMRGA (076) is the vertical it was shifted to
      // own from the shift date on, so it can be committed against there.
      `with snap as (
         select e.id as entity_id,
                coalesce(
                  (select max(as_of) from ar_open_items where entity_id = e.id and as_of <= $2),
                  (select min(as_of) from ar_open_items where entity_id = e.id)
                ) as as_of
           from unnest($1::int[]) as e(id)
       ),
       lines as (
         select coalesce(case when $2::date >= t.as_of then t.to_vertical_id end, a.vertical_id) as vertical_id,
                btrim(a.customer_name) as customer,
                a.balance_base as balance,
                coalesce(a.due_date, a.invoice_date) as due,
                (t.id is not null and $2::date >= t.as_of) as cmrga,
                s.as_of
           from ar_open_items a
           join snap s on s.entity_id = a.entity_id and a.as_of = s.as_of
           left join receivable_transfers t
             on t.entity_id = a.entity_id and t.invoice_number = a.invoice_number
          where a.customer_name is not null
       )
       select l.vertical_id,
              l.customer,
              sum(l.balance)::float8 as outstanding,
              coalesce(sum(l.balance) filter (where l.due < l.as_of), 0)::float8 as overdue,
              coalesce(sum(l.balance) filter (where l.cmrga), 0)::float8 as cmrga,
              max(l.as_of)::text as as_of
         from lines l
        where l.vertical_id = any($3::int[])
        group by l.vertical_id, l.customer
       having sum(l.balance) > 0
        order by 3 desc`,
      [memberIds, weekEnd, ids],
    );
    for (const r of open) {
      const list = receivablesByVertical.get(r.vertical_id) ?? [];
      list.push({
        customer: r.customer,
        outstanding: Number(r.outstanding),
        overdue: Number(r.overdue),
        cmrga: Number(r.cmrga),
      });
      receivablesByVertical.set(r.vertical_id, list);
      if (!arAsOf || r.as_of > arAsOf) arAsOf = r.as_of;
    }
  }

  const duplicateRowCodes = new Set(
    candidates
      .map((c) => c.rowCode)
      .filter((code, i, all) => all.indexOf(code) !== i),
  );

  const rows: WeeklyRow[] = candidates
    .map(({ v, rowCode }) => {
      const commit = commitByVertical.get(v.id) ?? null;
      const receivables = receivablesByVertical.get(v.id) ?? [];
      const owes = new Map(receivables.map((c) => [norm(c.customer), c.outstanding]));
      const lines: WeeklyLine[] = commit
        ? lineRows
            .filter((l) => l.commitment_id === commit.id)
            .map((l) => ({
              customer: l.customer_name,
              amount: Number(l.amount),
              actual: customerActual.get(`${v.id}|${norm(l.customer_name)}`) ?? 0,
              outstanding: measure === "collection" ? (owes.get(norm(l.customer_name)) ?? null) : null,
            }))
        : [];
      const committed = lines.reduce((s, l) => s + l.amount, 0);
      const actual = actualByVertical.get(v.id) ?? 0;
      // By the vertical's own company, so a stray same-coded vertical under the
      // other company takes no budget (see revisedBudgetForVertical).
      const weeklyBudget = revisedBudgetForVertical(slugOf.get(v.id) ?? "", v.code, weekStart, weekEnd);
      const budget = !weeklyBudget
        ? null
        : measure === "revenue"
          ? weeklyBudget.revenue
          : weeklyBudget.collection;
      // A vertical with a revenue budget is on the screen whichever measure is
      // showing, so a head always has the row to commit against.
      const budgeted = (weeklyBudget?.revenue ?? 0) > 0;
      const label = ROWS.find((r) => r.code === rowCode)?.label ?? v.name;
      return {
        verticalId: v.id,
        rowCode,
        label: duplicateRowCodes.has(rowCode) ? `${label} · ${v.code}` : label,
        budget,
        committed,
        hasCommitment: commit !== null,
        lines,
        actual,
        // null: nothing was shifted to this vertical, so no CMRGA note; zero is a note of Rs 0
        fromCmrga: cmrgaByVertical.get(v.id) ?? null,
        breakup: breakupByVertical.get(v.id) ?? [],
        pctOfCommitment: committed > 0 ? actual / committed : null,
        commitmentRating: ratingVsBudget(committed, budget),
        actualRating: ratingVsBudget(actual, budget),
        achieved: commit?.achieved ?? null,
        remarks: commit?.remarks ?? null,
        meetingDate: commit?.meeting_date ?? null,
        enteredOn: commit?.entered_on ?? null,
        locked: commit ? isLocked(commit.entered_on, commit.reopened_on, today) : false,
        reopenedOn: commit?.reopened_on ?? null,
        customers: customersByVertical.get(v.id) ?? [],
        receivableCustomers: receivables,
        receivableTotal: receivables.reduce((s, c) => s + c.outstanding, 0),
        receivableOverdue: receivables.reduce((s, c) => s + c.overdue, 0),
        receivableCmrga: receivables.reduce((s, c) => s + c.cmrga, 0),
        budgeted,
      };
    })
    // On the screen only if the vertical is budgeted, committed to, or traded this week.
    .filter((r) => r.budgeted || r.hasCommitment || r.actual !== 0)
    .map(({ budgeted, ...row }) => {
      void budgeted;
      return row;
    })
    .sort(
      (a, b) =>
        ROWS.findIndex((r) => r.code === a.rowCode) - ROWS.findIndex((r) => r.code === b.rowCode),
    );

  return {
    measure,
    weekStart,
    weekEnd,
    today,
    arAsOf,
    rows,
  };
}

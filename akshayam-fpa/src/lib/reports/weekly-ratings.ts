import { query } from "@/lib/db";
import { getVerticalsInScope, type Entity } from "@/lib/entity";
import { fyMonths } from "@/lib/period";
import {
  buildScorecard,
  resolveScorecardScope,
  ROWS,
  scorecardRowCodeFor,
} from "@/lib/reports/scorecard";
import { weeklyBudgetFor } from "@/lib/reports/scorecard-budget";
import { addDays, isLocked, todayIst, weeklyRating, type WeeklyMeasure } from "@/lib/weekly";

/**
 * The Weekly ratings screen's figures, for one week and one measure.
 *
 * Each vertical's head commits an amount before the week begins, customer by
 * customer; the week is then rated on what was actually achieved against that
 * commitment, on the Vertical Performance Scorecard's own bands. Nothing here
 * is stored but the commitment itself - the budget is the revised quarterly
 * budget spread over the week's days, the actual is read from the ledger, the
 * payments and the invoices every time, and the quarter's scorecard is struck
 * by the scorecard's own builder so the two never disagree.
 *
 * The three measures:
 *  - Revenue: the ledger's revenue for the vertical in the week (the figure the
 *    Revenue tab's Actual is made of), against the weekly budget.
 *  - Collection: fee receipts allocated to the vertical in the week, against
 *    108% of the weekly revenue budget.
 *  - Receivables: how much of the committed overdue was actually recovered -
 *    what was received in the week from the customers named in the commitment.
 *    There is no budget behind it; the commitment is the target.
 */

export interface WeeklyLine {
  customer: string;
  /** committed for this customer */
  amount: number;
  /** what the customer actually came to in the week - billed for revenue, received otherwise */
  actual: number;
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
  /** actual as a fraction of the commitment, or null where nothing was committed */
  pctOfCommitment: number | null;
  rating: number | null;
  achieved: "yes" | "partly" | "no" | null;
  remarks: string | null;
  meetingDate: string | null;
  enteredOn: string | null;
  /** the amounts can no longer be changed (the outcome still can) */
  locked: boolean;
  reopenedOn: string | null;
  /** the vertical's composite for the quarter the week falls in, from the scorecard */
  quarterComposite: number | null;
  /** customers a line can be picked from */
  customers: string[];
}

export interface WeeklyRatingsResult {
  measure: WeeklyMeasure;
  weekStart: string;
  weekEnd: string;
  quarterLabel: string;
  today: string;
  rows: WeeklyRow[];
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

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

  // ---- the quarter's scorecard, for the figure beside the week ----
  const year = Number(weekEnd.slice(0, 4));
  const month = Number(weekEnd.slice(5, 7));
  const fy = month >= 4 ? year : year - 1;
  const fyMonth = fyMonths(fy).find((m) => m.key === weekEnd.slice(0, 7));
  const quarter = fyMonth?.quarter ?? 1;
  const compositeByRow = new Map<string, number>();
  try {
    const { benchmark } = await resolveScorecardScope(entity);
    const card = await buildScorecard({ entity: benchmark, fyStartYear: fy, quarter, cumulative: false });
    for (const r of card.rows) compositeByRow.set(r.code, r.composite);
  } catch {
    // the scorecard is a companion figure; the week is still worth showing without it
  }

  const duplicateRowCodes = new Set(
    candidates
      .map((c) => c.rowCode)
      .filter((code, i, all) => all.indexOf(code) !== i),
  );

  const rows: WeeklyRow[] = candidates
    .map(({ v, rowCode }) => {
      const commit = commitByVertical.get(v.id) ?? null;
      const lines: WeeklyLine[] = commit
        ? lineRows
            .filter((l) => l.commitment_id === commit.id)
            .map((l) => ({
              customer: l.customer_name,
              amount: Number(l.amount),
              actual: customerActual.get(`${v.id}|${norm(l.customer_name)}`) ?? 0,
            }))
        : [];
      const committed = lines.reduce((s, l) => s + l.amount, 0);
      const actual =
        measure === "receivables"
          ? lines.reduce((s, l) => s + l.actual, 0)
          : (actualByVertical.get(v.id) ?? 0);
      const weeklyBudget = weeklyBudgetFor(slugOf.get(v.id) ?? "", rowCode, weekStart, weekEnd);
      const budget =
        measure === "receivables" || !weeklyBudget
          ? null
          : measure === "revenue"
            ? weeklyBudget.revenue
            : weeklyBudget.collection;
      // Whether the vertical is budgeted at all, whichever measure is on screen:
      // Receivables has no budget of its own, but a vertical that has revenue to
      // collect still has overdue to recover and must be there to commit.
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
        pctOfCommitment: committed > 0 ? actual / committed : null,
        rating: weeklyRating(actual, committed),
        achieved: commit?.achieved ?? null,
        remarks: commit?.remarks ?? null,
        meetingDate: commit?.meeting_date ?? null,
        enteredOn: commit?.entered_on ?? null,
        locked: commit ? isLocked(commit.entered_on, commit.reopened_on, today) : false,
        reopenedOn: commit?.reopened_on ?? null,
        quarterComposite: compositeByRow.get(rowCode) ?? null,
        customers: customersByVertical.get(v.id) ?? [],
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
    quarterLabel: `Q${quarter}`,
    today,
    rows,
  };
}

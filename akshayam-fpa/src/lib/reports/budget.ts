import { query } from "@/lib/db";
import { verticalScope, type Entity } from "@/lib/entity";

/**
 * Budget versus actual, by vertical.
 *
 * The period budget is the annual budget times the share of the year the
 * period covers. For a year-to-date view that share is whole months - a ledger
 * pasted to 24 August carries five months of budget, not four and
 * three-quarters - which is the firm's own convention and keeps the figure a
 * round twelfth multiple.
 *
 * Actuals:
 *   revenue      the ledger's Revenue from Operations - net of credit notes by
 *                construction, and equal to the P&L line exactly
 *   collection   fee receipts, excluding reimbursement recoveries, since a
 *                recharge of a client-paid cost is not collection performance
 */

export type Measure = "revenue" | "collection";

/** Draft key for activity carrying no vertical at all. */
const UNASSIGNED = "unassigned";

/** One window's worth of figures: what was budgeted, what happened, the gap. */
export interface BudgetCells {
  periodBudget: number;
  actual: number;
  variance: number;
  /** actual as a percentage of the period budget (0-100); null when there is no budget */
  achievement: number | null;
  /**
   * The split of actual between the monthly retainer and one-off work.
   * Null where the window is not whole months: retainers are billed monthly,
   * so a single week has no defensible share of one and inventing a fifth of a
   * month's retainer would put a number on the page that no invoice supports.
   */
  retainership: number | null;
  professional: number | null;
}

export interface BudgetRow {
  code: string | null;
  name: string;
  /**
   * True for the one row holding activity that carries no vertical at all.
   * Not the same as a null code: a budget line whose vertical has since been
   * deleted also has none, and that is a gap in the reference data rather than
   * a document nobody tagged.
   */
  unattributed: boolean;
  annual: number;
  /** the chosen week, month or year to date */
  period: BudgetCells;
  /** the year to date up to the end of that period; absent when they are the same */
  cumulative?: BudgetCells;
}

export interface BudgetVsActual {
  rows: BudgetRow[];
  total: BudgetRow;
  /** true when some actual activity sits outside every budgeted vertical */
  hasUnbudgeted: boolean;
  /** column heading for the cumulative group, when there is one */
  cumulativeLabel: string | null;
}

/** A date range and the share of the annual budget it earns. */
export interface BudgetWindow {
  start: string;
  end: string;
  fraction: number;
  label?: string;
  /** true when the window covers whole calendar months, so the retainer split applies */
  monthAligned?: boolean;
}

interface ActualRow {
  vertical_id: number | null;
  name: string | null;
  actual: number;
}

/** What a measure actually did between two dates, split by vertical. */
async function actualsByVertical(
  entityIds: number[],
  verticalIds: number[] | null,
  verticalId: number | null,
  measure: Measure,
  window: BudgetWindow,
): Promise<ActualRow[]> {
  if (measure === "revenue") {
    /**
     * Revenue as the ledger has it: the accounts mapped to Revenue from
     * Operations, signed credit less debit, split by the ledger's own
     * reporting tag.
     *
     * Taken from the ledger rather than the invoice register on purpose. It is
     * net of credit notes by construction - a credit note debits the revenue
     * account - and it equals the P&L line exactly, so budget performance and
     * the profit statement can never tell two different stories. The invoice
     * register also attributes by salesperson, which is a weaker signal than
     * the tag the entry was actually posted with: reading Common from the
     * ledger gives 11.8 L against the register's 3.2 L, and the ledger is the
     * one that agrees with the client's own report.
     */
    return query<ActualRow>(
      `select g.vertical_id, max(v.name) as name,
              sum(g.credit - g.debit)::numeric as actual
         from gl_entries g
         join accounts a on a.id = g.account_id
         left join verticals v on v.id = g.vertical_id
        where g.entity_id = any($1::int[]) and g.txn_date between $2 and $3
          and a.statement = 'pnl' and a.group_code = 'revenue'
          ${verticalScope("$4", "g.vertical_id")}
          and ($5::int is null or g.vertical_id = $5)
        group by g.vertical_id`,
      [entityIds, window.start, window.end, verticalIds, verticalId],
    );
  }

  // Fee receipts only: a reimbursement recovery is not collection performance,
  // and the allocation split is what keeps a mixed remittance out of the wrong
  // half.
  return query<ActualRow>(
    `select a.vertical_id, max(v.name) as name,
            sum(case when a.is_reimbursement then 0 else a.amount_base end)::numeric as actual
       from payment_allocations a
       join payments p on p.id = a.payment_id
       left join verticals v on v.id = a.vertical_id
      where a.entity_id = any($1::int[]) and p.payment_date between $2 and $3
        ${verticalScope("$4", "a.vertical_id")}
        and ($5::int is null or a.vertical_id = $5)
      group by a.vertical_id`,
    [entityIds, window.start, window.end, verticalIds, verticalId],
  );
}

function cells(
  annual: number,
  actual: number,
  fraction: number,
  retainership: number | null,
): BudgetCells {
  const periodBudget = annual * fraction;
  return {
    periodBudget,
    actual,
    variance: actual - periodBudget,
    achievement: periodBudget > 0 ? (actual / periodBudget) * 100 : null,
    retainership,
    // Professional fee is the remainder, never a second measurement. That is
    // what keeps the two halves adding to the ledger total exactly, so a
    // retainer figure that is slightly off shifts the split without ever
    // changing the revenue the page reports.
    professional: retainership === null ? null : actual - retainership,
  };
}

/** Monthly retainer billed in a window, by vertical. Empty unless whole months. */
async function retainersByVertical(
  entityIds: number[],
  verticalIds: number[] | null,
  verticalId: number | null,
  measure: Measure,
  window: BudgetWindow,
): Promise<Map<number | null, number>> {
  if (measure !== "revenue" || !window.monthAligned) return new Map();
  const rows = await query<{ vertical_id: number | null; amount: number }>(
    `select vertical_id, sum(amount_base)::numeric as amount
       from retainer_revenue
      where entity_id = any($1::int[]) and month between $2 and $3
        ${verticalScope("$4")}
        and ($5::int is null or vertical_id = $5)
      group by vertical_id`,
    [entityIds, window.start, window.end, verticalIds, verticalId],
  );
  return new Map(rows.map((r) => [r.vertical_id, Number(r.amount)]));
}

export async function buildBudgetVsActual(opts: {
  entity: Entity;
  fyStartYear: number;
  measure: Measure;
  /**
   * One vertical to report on, from the page's own picker. Narrows the budget
   * as well as the actual: a page filtered to one vertical must not measure it
   * against the whole company's target.
   */
  verticalId?: number | null;
  /** the chosen week, month or year to date */
  period: BudgetWindow;
  /** the year to date up to the end of that period, when it differs */
  cumulative?: BudgetWindow | null;
}): Promise<BudgetVsActual> {
  const { entity, fyStartYear, measure, period, cumulative, verticalId = null } = opts;
  const ids = entity.memberIds;
  /**
   * Only revenue splits. A retainer is an invoice, not a receipt: the cash for
   * one arrives whenever the client pays, so attributing part of a month's
   * collections to it would be a guess dressed as a fact.
   */
  const splits = measure === "revenue";

  const [
    budgets,
    verticals,
    periodActuals,
    cumulativeActuals,
    periodRetainers,
    cumulativeRetainers,
  ] = await Promise.all([
    query<{
      vertical_id: number | null;
      code: string | null;
      name: string;
      sort_order: number;
      annual: number;
    }>(
      `select b.vertical_id, v.code,
              coalesce(max(b.display_name), v.name, 'Unassigned') as name,
              min(b.sort_order) as sort_order,
              sum(b.annual_amount)::numeric as annual
         from budgets b
         left join verticals v on v.id = b.vertical_id
        where b.entity_id = any($1::int[]) and b.fy_start_year = $2 and b.measure = $3
          ${verticalScope("$4", "b.vertical_id")}
          and ($5::int is null or b.vertical_id = $5)
        group by b.vertical_id, v.code, v.name`,
      [ids, fyStartYear, measure, entity.verticalIds, verticalId],
    ),
    query<{ id: number; code: string }>(
      "select id, code from verticals where entity_id = any($1::int[])",
      [ids],
    ),
    actualsByVertical(ids, entity.verticalIds, verticalId, measure, period),
    cumulative
      ? actualsByVertical(ids, entity.verticalIds, verticalId, measure, cumulative)
      : Promise.resolve([]),
    retainersByVertical(ids, entity.verticalIds, verticalId, measure, period),
    cumulative
      ? retainersByVertical(ids, entity.verticalIds, verticalId, measure, cumulative)
      : Promise.resolve(new Map<number | null, number>()),
  ]);

  /**
   * Budgets and actuals are held per entity, but the group reports one line per
   * vertical *code* - RBJV's AIF and Akshayam's GIFT are different rows, while
   * the same code in both companies is one. Keying on the code rather than the
   * id is what makes the consolidated view add up instead of listing a vertical
   * twice.
   */
  const codeOf = new Map(verticals.map((v) => [v.id, v.code]));
  const keyOf = (code: string | null, verticalId: number | null) =>
    code ?? (verticalId === null ? UNASSIGNED : `id:${verticalId}`);

  interface Draft {
    code: string | null;
    name: string;
    unattributed: boolean;
    /** the budget's own running order; unbudgeted lines sort after it */
    order: number;
    annual: number;
    periodActual: number;
    cumulativeActual: number;
    periodRetainer: number;
    cumulativeRetainer: number;
  }
  const drafts = new Map<string, Draft>();

  for (const b of budgets) {
    const key = keyOf(b.code, b.vertical_id);
    const existing = drafts.get(key);
    if (existing) existing.annual += Number(b.annual);
    else
      drafts.set(key, {
        code: b.code,
        name: b.name,
        unattributed: key === UNASSIGNED,
        order: Number(b.sort_order),
        annual: Number(b.annual),
        periodActual: 0,
        cumulativeActual: 0,
        periodRetainer: 0,
        cumulativeRetainer: 0,
      });
  }

  let hasUnbudgeted = false;
  const post = (rows: ActualRow[], field: "periodActual" | "cumulativeActual") => {
    for (const a of rows) {
      const code = a.vertical_id === null ? null : (codeOf.get(a.vertical_id) ?? null);
      const key = keyOf(code, a.vertical_id);
      let draft = drafts.get(key);
      if (!draft) {
        // Activity in a vertical nobody budgeted. Shown rather than dropped: a
        // dashboard whose actuals do not add up to the page's own total is
        // worse than one with an awkward extra line.
        hasUnbudgeted = true;
        draft = {
          code,
          name: a.name ?? "Not attributed to a vertical",
          unattributed: key === UNASSIGNED,
          order: 9999,
          annual: 0,
          periodActual: 0,
          cumulativeActual: 0,
          periodRetainer: 0,
          cumulativeRetainer: 0,
        };
        drafts.set(key, draft);
      }
      draft[field] += Number(a.actual);
    }
  };
  post(periodActuals, "periodActual");
  if (cumulative) post(cumulativeActuals, "cumulativeActual");

  const postRetainers = (
    source: Map<number | null, number>,
    field: "periodRetainer" | "cumulativeRetainer",
  ) => {
    for (const [verticalId, amount] of source) {
      const code = verticalId === null ? null : (codeOf.get(verticalId) ?? null);
      const draft = drafts.get(keyOf(code, verticalId));
      // A retainer against a vertical with no revenue and no budget has nowhere
      // to sit; the actuals loop above would already have created a row for any
      // vertical that billed anything at all.
      if (draft) draft[field] += Number(amount);
    }
  };
  postRetainers(periodRetainers, "periodRetainer");
  if (cumulative) postRetainers(cumulativeRetainers, "cumulativeRetainer");

  const rows: BudgetRow[] = [...drafts.values()]
    // The budget's running order, not size. The partners know the schedule by
    // its sequence and read down it for their own line; re-sorting the report
    // against the thing it reports on only makes them hunt.
    .sort((a, b) => a.order - b.order || b.annual - a.annual)
    .map((d) => ({
      code: d.code,
      name: d.name,
      unattributed: d.unattributed,
      annual: d.annual,
      period: cells(
        d.annual,
        d.periodActual,
        period.fraction,
        splits && period.monthAligned ? d.periodRetainer : null,
      ),
      ...(cumulative
        ? {
            cumulative: cells(
              d.annual,
              d.cumulativeActual,
              cumulative.fraction,
              splits && cumulative.monthAligned ? d.cumulativeRetainer : null,
            ),
          }
        : {}),
    }));

  const sum = (pick: (r: BudgetRow) => BudgetCells | undefined) =>
    rows.reduce((t, r) => t + (pick(r)?.actual ?? 0), 0);
  const sumRetainer = (pick: (r: BudgetRow) => BudgetCells | undefined) =>
    rows.reduce((t, r) => t + (pick(r)?.retainership ?? 0), 0);
  const annual = rows.reduce((t, r) => t + r.annual, 0);

  const total: BudgetRow = {
    code: null,
    name: "Total",
    unattributed: false,
    annual,
    period: cells(
      annual,
      sum((r) => r.period),
      period.fraction,
      splits && period.monthAligned ? sumRetainer((r) => r.period) : null,
    ),
    ...(cumulative
      ? {
          cumulative: cells(
            annual,
            sum((r) => r.cumulative),
            cumulative.fraction,
            splits && cumulative.monthAligned ? sumRetainer((r) => r.cumulative) : null,
          ),
        }
      : {}),
  };

  return { rows, total, hasUnbudgeted, cumulativeLabel: cumulative?.label ?? null };
}

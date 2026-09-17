import { query } from "@/lib/db";
import type { Entity } from "@/lib/entity";
import { fyBounds, type FyMonth } from "@/lib/period";

/**
 * The breakdown behind "Establishment cost", budget against actual.
 *
 * Establishment cost is the cost of having premises at all - rent, the office
 * upkeep, the electricity bill. The statement shows it as one line; this is
 * what it is made of.
 *
 * Unlike the Other-expenses breakdown, the actual here is read straight from
 * the ledger: the establishment-cost accounts (Rent Expense, Building
 * maintenance, Electricity Charges) map cleanly onto the three budget lines,
 * so there is nothing to key by hand and the card ties to the statement's
 * Establishment cost line exactly. Each line can be opened to the postings
 * behind its actual.
 *
 * The budget split is the office schedule the partners agreed - three annual
 * figures that sum to the establishment-cost total in budget_pnl - spread
 * evenly across the year, the same way that total is.
 *
 * Every line carries the same two windows the Other-expenses breakdown does:
 * the period the page's own picker is showing, and the year to date, shown
 * regardless of that picker so a reader is never cut off from the full-year
 * story. Variance and its percentage are struck on the year-to-date pair
 * only. The query reads the whole financial year once and buckets it into
 * the two windows in JS - the same shape expense-detail.ts uses - so a
 * period narrower than the ledger's reach never has to re-ask the database.
 */

/** One ledger posting behind a line's actual - what a drill-down shows. */
export interface EstablishmentEntry {
  /** YYYY-MM-DD */
  date: string;
  /** the bill's contact/narration, or the transaction type when it has none */
  particulars: string;
  /** the ledger's reference-number field, shown as the description */
  description: string;
  /** cost-positive rupees */
  amount: number;
}

export interface EstablishmentLine {
  label: string;
  /** the whole-year budget for this line */
  annualBudget: number;
  /** the budget for the page's own period (annual prorated on whole months) */
  periodBudget: number;
  /** the sum of postings recorded in that period */
  periodActual: number;
  /** the budget from the start of the year to the ledger's latest complete month */
  ytdBudget: number;
  /** the sum of postings recorded year to date */
  ytdActual: number;
  /** ytdBudget less ytdActual - a cost under budget is favourable */
  ytdVariance: number;
  /** ytdVariance as a percentage of ytdBudget, null when there is no YTD budget */
  ytdVariancePct: number | null;
  /** an account the ledger carries under establishment cost that no budget line claims */
  isActualOnly?: boolean;
  /**
   * The ledger postings behind the period's own actual, newest first - a
   * posting belongs to the month it was dated in, so only the period's own
   * postings are ever shown here regardless of how the YTD columns read.
   */
  entries: EstablishmentEntry[];
}

export interface EstablishmentResult {
  hasData: boolean;
  lines: EstablishmentLine[];
  totals: {
    periodBudget: number;
    periodActual: number;
    ytdBudget: number;
    ytdActual: number;
    ytdVariance: number;
    ytdVariancePct: number | null;
  };
}

/**
 * The agreed office schedule, by entity. Annual figures, spread evenly - they
 * sum to the entity's establishment_cost total in budget_pnl. RBJV only; other
 * companies carry no line-by-line establishment schedule.
 */
const ANNUAL_BUDGET: Record<number, { label: string; annual: number; match: RegExp }[]> = {
  // RBJV: 37,07,760 + 5,03,196 + 9,00,000 = 51,10,956 = budget_pnl establishment_cost.
  1: [
    { label: "Rent", annual: 3707760, match: /rent/i },
    { label: "Office maintenance", annual: 503196, match: /maint|building/i },
    { label: "Electricity", annual: 900000, match: /electric/i },
  ],
};

export async function buildEstablishmentDetail(opts: {
  entity: Entity;
  fyStartYear: number;
  /** the months being compared on, from the page's period picker */
  periodMonths: FyMonth[];
  /** the months from the start of the year to the ledger's latest complete month */
  ytdMonths: FyMonth[];
}): Promise<EstablishmentResult> {
  const { entity, fyStartYear, periodMonths, ytdMonths } = opts;
  const plan = ANNUAL_BUDGET[entity.id];
  const empty: EstablishmentResult = {
    hasData: false,
    lines: [],
    totals: { periodBudget: 0, periodActual: 0, ytdBudget: 0, ytdActual: 0, ytdVariance: 0, ytdVariancePct: null },
  };
  if (!plan || periodMonths.length === 0) return empty;

  const periodFraction = periodMonths.length / 12;
  const ytdFraction = ytdMonths.length / 12;
  const periodKeys = new Set(periodMonths.map((m) => m.key));
  const ytdKeys = new Set(ytdMonths.map((m) => m.key));

  const { start: fyStart, end: fyEnd } = fyBounds(fyStartYear, entity.fy_start_month);

  // Every establishment-cost posting for the whole year, kept as its own row
  // so a line can be drilled into and bucketed by month for the two windows.
  // debit less credit puts a cost positive - the same sign the statement's
  // Establishment cost line lands on.
  const rows = await query<{
    name: string;
    month_key: string;
    txn_date: string;
    particulars: string | null;
    reference: string | null;
    txn_type: string | null;
    amount: number;
  }>(
    `select a.name,
            to_char(g.txn_date, 'YYYY-MM') as month_key,
            to_char(g.txn_date, 'YYYY-MM-DD') as txn_date,
            nullif(btrim(g.description), '') as particulars,
            nullif(btrim(g.reference), '')  as reference,
            g.txn_type,
            (g.debit - g.credit) as amount
       from gl_entries g
       join accounts a on a.id = g.account_id
      where g.entity_id = any($1::int[]) and g.txn_date between $2 and $3
        and a.statement = 'pnl' and a.group_code = 'establishment_cost'
        and not ($4::boolean and a.is_intercompany)
      order by g.txn_date desc, g.id desc`,
    [entity.memberIds, fyStart, fyEnd, entity.consolidates],
  );

  const toEntry = (r: (typeof rows)[number]): EstablishmentEntry => ({
    date: r.txn_date,
    particulars: r.particulars ?? r.txn_type ?? "—",
    description: r.reference ?? "",
    amount: Number(r.amount),
  });
  const sumRows = (rs: typeof rows, keys: Set<string>) =>
    rs.filter((r) => keys.has(r.month_key)).reduce((s, r) => s + Number(r.amount), 0);

  const lines: EstablishmentLine[] = plan.map((p) => {
    const matched = rows.filter((r) => p.match.test(r.name));
    const periodActual = sumRows(matched, periodKeys);
    const ytdActual = sumRows(matched, ytdKeys);
    const periodBudget = p.annual * periodFraction;
    const ytdBudget = p.annual * ytdFraction;
    const ytdVariance = ytdBudget - ytdActual;
    return {
      label: p.label,
      annualBudget: p.annual,
      periodBudget,
      periodActual,
      ytdBudget,
      ytdActual,
      ytdVariance,
      ytdVariancePct: ytdBudget ? (ytdVariance / ytdBudget) * 100 : null,
      entries: matched.filter((r) => periodKeys.has(r.month_key)).map(toEntry),
    };
  });

  // Anything the ledger posts under establishment cost that none of the known
  // lines claim - shown so the card always ties to the statement.
  const claimed = (name: string) => plan.some((p) => p.match.test(name));
  const otherRows = rows.filter((r) => !claimed(r.name));
  const otherPeriodActual = sumRows(otherRows, periodKeys);
  const otherYtdActual = sumRows(otherRows, ytdKeys);
  if (Math.abs(otherPeriodActual) > 0.5 || Math.abs(otherYtdActual) > 0.5) {
    lines.push({
      label: "Other establishment",
      annualBudget: 0,
      periodBudget: 0,
      periodActual: otherPeriodActual,
      ytdBudget: 0,
      ytdActual: otherYtdActual,
      ytdVariance: -otherYtdActual,
      ytdVariancePct: null,
      isActualOnly: true,
      entries: otherRows.filter((r) => periodKeys.has(r.month_key)).map(toEntry),
    });
  }

  const totals = lines.reduce(
    (t, l) => ({
      periodBudget: t.periodBudget + l.periodBudget,
      periodActual: t.periodActual + l.periodActual,
      ytdBudget: t.ytdBudget + l.ytdBudget,
      ytdActual: t.ytdActual + l.ytdActual,
      ytdVariance: t.ytdVariance + l.ytdVariance,
    }),
    { periodBudget: 0, periodActual: 0, ytdBudget: 0, ytdActual: 0, ytdVariance: 0 },
  );

  return {
    hasData: true,
    lines,
    totals: {
      ...totals,
      ytdVariancePct: totals.ytdBudget ? (totals.ytdVariance / totals.ytdBudget) * 100 : null,
    },
  };
}

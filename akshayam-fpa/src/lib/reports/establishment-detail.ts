import { query } from "@/lib/db";
import type { Entity } from "@/lib/entity";
import type { FyMonth } from "@/lib/period";

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
  /** the budget for the period on screen (annual prorated on whole months) */
  budget: number;
  actual: number;
  variance: number;
  /** actual as a percentage of the period budget, or null when there is no budget */
  variancePct: number | null;
  /** an account the ledger carries under establishment cost that no budget line claims */
  isActualOnly?: boolean;
  /** the ledger postings that make up `actual`, newest first */
  entries: EstablishmentEntry[];
}

export interface EstablishmentResult {
  hasData: boolean;
  lines: EstablishmentLine[];
  totals: { budget: number; actual: number; variance: number };
  /** the ledger's whole establishment-cost figure, as a control on the lines above */
  ledger: number;
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
  /** the months being compared on, from the page's period picker */
  periodMonths: FyMonth[];
  /** the exact dates for the actual side */
  window: { start: string; end: string };
}): Promise<EstablishmentResult> {
  const { entity, periodMonths, window } = opts;
  const plan = ANNUAL_BUDGET[entity.id];
  if (!plan || periodMonths.length === 0) {
    return { hasData: false, lines: [], totals: { budget: 0, actual: 0, variance: 0 }, ledger: 0 };
  }

  const fraction = periodMonths.length / 12;

  // Every establishment-cost posting for the period, kept as its own row so a
  // line can be drilled into. debit less credit puts a cost positive - the
  // same sign the statement's Establishment cost line lands on.
  const rows = await query<{
    name: string;
    txn_date: string;
    particulars: string | null;
    reference: string | null;
    txn_type: string | null;
    amount: number;
  }>(
    `select a.name,
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
    [entity.memberIds, window.start, window.end, entity.consolidates],
  );

  const toEntry = (r: (typeof rows)[number]): EstablishmentEntry => ({
    date: r.txn_date,
    particulars: r.particulars ?? r.txn_type ?? "—",
    description: r.reference ?? "",
    amount: Number(r.amount),
  });

  const lines: EstablishmentLine[] = plan.map((p) => {
    const matched = rows.filter((r) => p.match.test(r.name));
    const actual = matched.reduce((s, r) => s + Number(r.amount), 0);
    const budget = p.annual * fraction;
    const variance = budget - actual;
    return {
      label: p.label,
      annualBudget: p.annual,
      budget,
      actual,
      variance,
      variancePct: budget ? (variance / budget) * 100 : null,
      entries: matched.map(toEntry),
    };
  });

  // Anything the ledger posts under establishment cost that none of the known
  // lines claim - shown so the card always ties to the statement.
  const claimed = (name: string) => plan.some((p) => p.match.test(name));
  const otherRows = rows.filter((r) => !claimed(r.name));
  const otherActual = otherRows.reduce((s, r) => s + Number(r.amount), 0);
  if (Math.abs(otherActual) > 0.5) {
    lines.push({
      label: "Other establishment",
      annualBudget: 0,
      budget: 0,
      actual: otherActual,
      variance: -otherActual,
      variancePct: null,
      isActualOnly: true,
      entries: otherRows.map(toEntry),
    });
  }

  const totals = lines.reduce(
    (t, l) => ({
      budget: t.budget + l.budget,
      actual: t.actual + l.actual,
      variance: t.variance + l.variance,
    }),
    { budget: 0, actual: 0, variance: 0 },
  );

  return {
    hasData: true,
    lines,
    totals,
    ledger: rows.reduce((s, r) => s + Number(r.amount), 0),
  };
}

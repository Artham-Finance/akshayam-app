import { query } from "@/lib/db";
import type { Entity } from "@/lib/entity";
import { fyBounds, type FyMonth } from "@/lib/period";
import type { EstablishmentResult } from "@/lib/reports/establishment-detail";

/**
 * A hand-scheduled budget-vs-actual breakdown, read straight from named
 * ledger accounts - the same shape establishment-detail.ts already built for
 * RBJV's Establishment cost card, generalised so any entity's own hardcoded
 * office or overhead schedule can reuse it (and the same
 * EstablishmentCostTable component) without a schedule invented for one
 * company leaking into another's.
 *
 * Matched by exact account name, not a regex: every schedule here is a short,
 * closed list the source budget sheet itself named, so there is no "anything
 * else" to sweep up the way establishment-detail.ts's own remainder line
 * does for RBJV.
 */

export interface LineItemSchedule {
  label: string;
  /** the whole-year budget, from the planning workbook */
  annual: number;
  /** exact ledger account name(s) this line's actual is read from */
  accountNames: string[];
}

export async function buildLineItemBudget(opts: {
  entity: Entity;
  fyStartYear: number;
  periodMonths: FyMonth[];
  ytdMonths: FyMonth[];
  schedule: LineItemSchedule[];
}): Promise<EstablishmentResult> {
  const { entity, fyStartYear, periodMonths, ytdMonths, schedule } = opts;
  const empty: EstablishmentResult = {
    hasData: false,
    lines: [],
    totals: { periodBudget: 0, periodActual: 0, ytdBudget: 0, ytdActual: 0, ytdVariance: 0, ytdVariancePct: null },
  };
  if (schedule.length === 0 || periodMonths.length === 0) return empty;

  const periodFraction = periodMonths.length / 12;
  const ytdFraction = ytdMonths.length / 12;
  const periodKeys = new Set(periodMonths.map((m) => m.key));
  const ytdKeys = new Set(ytdMonths.map((m) => m.key));
  const { start: fyStart, end: fyEnd } = fyBounds(fyStartYear, entity.fy_start_month);

  const allAccountNames = schedule.flatMap((s) => s.accountNames);

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
        and a.statement = 'pnl' and a.name = any($4::text[])
        and not ($5::boolean and a.is_intercompany)
      order by g.txn_date desc, g.id desc`,
    [entity.memberIds, fyStart, fyEnd, allAccountNames, entity.consolidates],
  );

  const toEntry = (r: (typeof rows)[number]) => ({
    date: r.txn_date,
    particulars: r.particulars ?? r.txn_type ?? "—",
    description: r.reference ?? "",
    amount: Number(r.amount),
  });
  const sumRows = (rs: typeof rows, keys: Set<string>) =>
    rs.filter((r) => keys.has(r.month_key)).reduce((s, r) => s + Number(r.amount), 0);

  const lines = schedule.map((s) => {
    const matched = rows.filter((r) => s.accountNames.includes(r.name));
    const periodActual = sumRows(matched, periodKeys);
    const ytdActual = sumRows(matched, ytdKeys);
    const periodBudget = s.annual * periodFraction;
    const ytdBudget = s.annual * ytdFraction;
    const ytdVariance = ytdBudget - ytdActual;
    return {
      label: s.label,
      annualBudget: s.annual,
      periodBudget,
      periodActual,
      ytdBudget,
      ytdActual,
      ytdVariance,
      ytdVariancePct: ytdBudget ? (ytdVariance / ytdBudget) * 100 : null,
      entries: matched.filter((r) => periodKeys.has(r.month_key)).map(toEntry),
    };
  });

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

/**
 * Akshayam's own office and overhead schedule, from "4 - Akshayam Monthly" -
 * confirmed against the sheet directly, the same way RBJV's Establishment
 * cost schedule (establishment-detail.ts) was. Rent and its maintenance are
 * combined into one line, per the plan; "Flat Maintanance" is its own ledger
 * account, tagged overheads rather than establishment_cost, but is still the
 * maintenance half of the same budgeted line, so its actual is read in here
 * too rather than left to surface as unexplained overhead elsewhere.
 */
export const AKSHAYAM_ESTABLISHMENT_SCHEDULE: LineItemSchedule[] = [
  { label: "Branch Office Rent — GIFT City", annual: 816000, accountNames: ["Branch Office Rent"] },
  {
    label: "Flat Rent & Maintenance",
    annual: 69000,
    accountNames: ["Flat Rent", "Flat Maintanance"],
  },
];

export const AKSHAYAM_OTHER_EXPENSES_SCHEDULE: LineItemSchedule[] = [
  { label: "Accounting support", annual: 240000, accountNames: ["Accounting  Services Fees"] },
  { label: "Other Expenses", annual: 300000, accountNames: ["Other Expenses"] },
];

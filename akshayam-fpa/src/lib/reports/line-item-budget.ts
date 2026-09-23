import { query } from "@/lib/db";
import type { Entity } from "@/lib/entity";
import { fyBounds, type FyMonth } from "@/lib/period";
import type { EstablishmentLine, EstablishmentResult } from "@/lib/reports/establishment-detail";

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
  /** the whole-year budget, from the planning workbook - the sum of `monthly` when given */
  annual: number;
  /**
   * The workbook's own month-by-month figure, keyed by calendar month
   * ("04"..."12", "01"..."03"), for a line the sheet does not budget evenly
   * across the year - a rent that runs for one quarter and then stops, say.
   * Read in preference to spreading `annual` evenly whenever a month is
   * missing from this map it is budgeted at zero, not at the annual average.
   */
  monthly?: Partial<Record<string, number>>;
  /** exact ledger account name(s) this line's actual is read from */
  accountNames: string[];
}

export async function buildLineItemBudget(opts: {
  entity: Entity;
  fyStartYear: number;
  periodMonths: FyMonth[];
  ytdMonths: FyMonth[];
  schedule: LineItemSchedule[];
  /**
   * Sweep up whatever the ledger posts to this group that no schedule line
   * claims, one line per account rather than a single opaque remainder - a
   * schedule written from the budget file only ever names the accounts the
   * file itself budgets, and a real ledger always carries a few more
   * (write-offs, bank charges, a one-off) that are still real cost and would
   * otherwise vanish from the breakdown while still counting toward the
   * statement line above it.
   */
  catchAll?: {
    /**
     * Every group_code that folds into this schedule's statement line - for
     * Overheads that is 'overheads' itself, plus 'other_income' and
     * 'reimbursements' (see GROUP_TO_LINE in budget-pnl.ts), or the sweep
     * only ever reconciles to a line the statement does not actually strike.
     */
    groupCodes: string[];
    /** an account already read into a *different* schedule (Flat Maintanance under Establishment cost, say) - not repeated here */
    exclude?: string[];
  };
}): Promise<EstablishmentResult> {
  const { entity, fyStartYear, periodMonths, ytdMonths, schedule, catchAll } = opts;
  const empty: EstablishmentResult = {
    hasData: false,
    lines: [],
    totals: { periodBudget: 0, periodActual: 0, ytdBudget: 0, ytdActual: 0, ytdVariance: 0, ytdVariancePct: null },
  };
  if ((schedule.length === 0 && !catchAll) || periodMonths.length === 0) return empty;

  const periodFraction = periodMonths.length / 12;
  const ytdFraction = ytdMonths.length / 12;
  const periodKeys = new Set(periodMonths.map((m) => m.key));
  const ytdKeys = new Set(ytdMonths.map((m) => m.key));
  const { start: fyStart, end: fyEnd } = fyBounds(fyStartYear, entity.fy_start_month);

  const allAccountNames = schedule.flatMap((s) => s.accountNames);

  const [rows, catchAllRows] = await Promise.all([
    query<{
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
    ),
    catchAll
      ? query<{
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
              and a.statement = 'pnl' and a.group_code = any($4::text[])
              and not (a.name = any($5::text[]))
              and not ($6::boolean and a.is_intercompany)
            order by a.name, g.txn_date desc, g.id desc`,
          [
            entity.memberIds,
            fyStart,
            fyEnd,
            catchAll.groupCodes,
            [...allAccountNames, ...(catchAll.exclude ?? [])],
            entity.consolidates,
          ],
        )
      : Promise.resolve([]),
  ]);

  const toEntry = (r: (typeof rows)[number]) => ({
    date: r.txn_date,
    particulars: r.particulars ?? r.txn_type ?? "—",
    description: r.reference ?? "",
    amount: Number(r.amount),
  });
  const sumRows = (rs: typeof rows, keys: Set<string>) =>
    rs.filter((r) => keys.has(r.month_key)).reduce((s, r) => s + Number(r.amount), 0);

  const budgetOver = (s: LineItemSchedule, monthKeys: Set<string>, fraction: number) => {
    if (!s.monthly) return s.annual * fraction;
    let total = 0;
    for (const key of monthKeys) total += s.monthly[key.slice(5, 7)] ?? 0;
    return total;
  };

  const lines: EstablishmentLine[] = schedule.map((s) => {
    const matched = rows.filter((r) => s.accountNames.includes(r.name));
    const periodActual = sumRows(matched, periodKeys);
    const ytdActual = sumRows(matched, ytdKeys);
    const periodBudget = budgetOver(s, periodKeys, periodFraction);
    const ytdBudget = budgetOver(s, ytdKeys, ytdFraction);
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
      ytdEntries: matched.filter((r) => ytdKeys.has(r.month_key)).map(toEntry),
    };
  });

  // One line per account the ledger carries under this group that no
  // schedule line named - budget nil, since the file never budgeted it, but
  // shown by its own real name rather than folded into a total nobody can
  // trace back to a posting.
  for (const name of [...new Set(catchAllRows.map((r) => r.name))]) {
    const matched = catchAllRows.filter((r) => r.name === name);
    const periodActual = sumRows(matched, periodKeys);
    const ytdActual = sumRows(matched, ytdKeys);
    if (Math.abs(periodActual) < 0.5 && Math.abs(ytdActual) < 0.5) continue;
    lines.push({
      label: name,
      annualBudget: 0,
      periodBudget: 0,
      periodActual,
      ytdBudget: 0,
      ytdActual,
      ytdVariance: -ytdActual,
      ytdVariancePct: null,
      isActualOnly: true,
      entries: matched.filter((r) => periodKeys.has(r.month_key)).map(toEntry),
      ytdEntries: matched.filter((r) => ytdKeys.has(r.month_key)).map(toEntry),
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

/**
 * Akshayam's own office and overhead schedule, from "4 - Akshayam Monthly" -
 * confirmed against the sheet directly, the same way RBJV's Establishment
 * cost schedule (establishment-detail.ts) was. Rent and its maintenance are
 * combined into one line, per the plan; "Flat Maintanance" is its own ledger
 * account, tagged overheads rather than establishment_cost, but is still the
 * maintenance half of the same budgeted line, so its actual is read in here
 * too rather than left to surface as unexplained overhead elsewhere.
 */
/** "04" through "03" - every month of the FY the workbook's own columns run, April first. */
const ALL_MONTHS = ["04", "05", "06", "07", "08", "09", "10", "11", "12", "01", "02", "03"];

/** The same figure in every month of the FY, from the workbook's own columns - not assumed, read off the sheet and found even. */
const flat = (amount: number): Record<string, number> =>
  Object.fromEntries(ALL_MONTHS.map((m) => [m, amount]));

export const AKSHAYAM_ESTABLISHMENT_SCHEDULE: LineItemSchedule[] = [
  {
    label: "Branch Office Rent — GIFT City",
    annual: 816000,
    monthly: flat(68000),
    accountNames: ["Branch Office Rent"],
  },
  {
    // Budgeted for Q1 only - the sheet's own Jul-Mar columns are blank, not
    // an equal share of the annual figure. See "why is this 5,750" in the
    // load history: spreading 69,000 evenly across twelve months invented a
    // Rs 5,750 a month the workbook never budgeted past June.
    label: "Flat Rent & Maintenance",
    annual: 69000,
    monthly: { "04": 23000, "05": 23000, "06": 23000 },
    accountNames: ["Flat Rent", "Flat Maintanance"],
  },
];

export const AKSHAYAM_OTHER_EXPENSES_SCHEDULE: LineItemSchedule[] = [
  {
    label: "Accounting support",
    annual: 240000,
    monthly: flat(20000),
    accountNames: ["Accounting  Services Fees"],
  },
  { label: "Other Expenses", annual: 300000, monthly: flat(25000), accountNames: ["Other Expenses"] },
];

import { query } from "@/lib/db";
import { getVerticalsInScope, type Entity } from "@/lib/entity";
import { fyBounds, type FyMonth } from "@/lib/period";

/**
 * Team cost, broken out by role, with a vertical picker.
 *
 * The Budget vs Actual statement carries "Team cost" (the direct_cost group) as
 * one company figure a month. This is what it is made of: the team lead, the
 * external consultant, VPP, the salaried employees and the trainees.
 *
 * The budget is hard-coded here, straight from the firm's "team cost - budget"
 * workbook - one annual figure per vertical x role. The actual is read from the
 * general ledger: every direct_cost entry carries a vertical tag, so the actual
 * is grouped by vertical and account (same source and sign as the P&L) and
 * mapped to these roles:
 *
 *   Professional Fees            -> Team lead
 *   Consultancy Charges          -> External consultant
 *   Performance Incentive        -> VPP
 *   Salaries and Employee Wages  -> Employee
 *
 * Trainee stipends are not booked to their own ledger account, so that row's
 * actual stays nil. Any other direct_cost account falls to External consultant
 * so the card's total still ties to the statement's Team cost line.
 *
 * The card shows one scope at a time: the whole company by default, or a
 * single vertical from the picker.
 */

export type TeamRole =
  | "team_lead"
  | "external_consultant"
  | "vpp"
  | "salary_stipend";

/** The workbook's own budget rows, before Employee and Trainee are combined. */
type BudgetKey =
  | "team_lead"
  | "external_consultant"
  | "vpp"
  | "employee"
  | "trainee";

export const TEAM_ROLES: {
  key: TeamRole;
  label: string;
  hint?: string;
  /** the workbook rows that feed this line's budget */
  budgetKeys: BudgetKey[];
  /** the GL account(s) whose postings are this line's actual */
  glAccounts: string[];
}[] = [
  {
    key: "team_lead",
    label: "Team lead",
    hint: "Professional Fees",
    budgetKeys: ["team_lead"],
    glAccounts: ["Professional Fees"],
  },
  {
    key: "external_consultant",
    label: "External consultant",
    hint: "Consultancy Charges",
    budgetKeys: ["external_consultant"],
    glAccounts: ["Consultancy Charges"],
  },
  {
    key: "vpp",
    label: "VPP",
    hint: "Performance Incentive",
    budgetKeys: ["vpp"],
    glAccounts: ["Performance Incentive"],
  },
  {
    key: "salary_stipend",
    label: "Salary & stipend",
    hint: "Employee + Trainee — Salaries & Employee Wages",
    budgetKeys: ["employee", "trainee"],
    glAccounts: ["Salaries and Employee Wages"],
  },
];

/** GL direct-cost account -> the card role its actual is read into. */
const ACCOUNT_ROLE: Record<string, TeamRole> = {
  "Professional Fees": "team_lead",
  "Consultancy Charges": "external_consultant",
  "Performance Incentive": "vpp",
  "Salaries and Employee Wages": "salary_stipend",
};
// Anything else tagged direct_cost (e.g. MCA Expenses) lands here, so the
// role rows always sum back to the statement's Team cost actual.
const FALLBACK_ROLE: TeamRole = "external_consultant";

/**
 * Annual team-cost budget, by vertical code and workbook row, from "team cost -
 * budget.xlsx". Verticals not listed here (and every vertical of an entity
 * that has no block at all) carry a nil budget. Figures are whole rupees; VPP
 * was rounded from the workbook's paise-level values.
 *
 * The RBJV columns come to 2,57,91,406 - the figure budget_pnl holds for RBJV's
 * direct_cost for FY 2026-27. GIFT (Akshayam) adds 25,81,931 on top - Professional
 * fee 8,31,600 + Salaries and Stipend 9,27,240 + VPP 8,23,091, "4 - Akshayam
 * Monthly"'s own figures - which is also what budget_pnl holds for Akshayam, so
 * the Group ties to 2,83,73,337. AIF is deliberately nil - the workbook carries a
 * zero column for it.
 */
export const TEAM_COST_ANNUAL_BUDGET: Record<
  string,
  Partial<Record<BudgetKey, number>>
> = {
  ECM: { team_lead: 812556, vpp: 272204, trainee: 223440 },
  GADD: { team_lead: 378000, vpp: 538944, trainee: 411720 },
  CMRGA: { team_lead: 768600, vpp: 1976355, trainee: 283920 },
  DLR: { team_lead: 504000, external_consultant: 5000000, vpp: 2343616, trainee: 614880 },
  RRG: { team_lead: 466200, vpp: 1007665, trainee: 372000 },
  CFC: { team_lead: 831600, vpp: 1518906, trainee: 525720 },
  AIF: {},
  // DSC and support - Vaithy is the team lead; no budget agreed, so nil.
  DSC: {},
  HRCM: { team_lead: 352800, external_consultant: 1200000, vpp: 200000, employee: 120000 },
  ACC: { team_lead: 554400, vpp: 800000, trainee: 623280 },
  COMMON: {
    team_lead: 138600,
    external_consultant: 2400000,
    vpp: 120000,
    employee: 432000,
  },
  // Akshayam Corporate Advisors, from "4 - Akshayam Monthly" directly (V7):
  // Raja Krishnan as team lead, the "Professional fee" row (8,31,600);
  // Abhinaya, Gowtham, Riya and Ankith together on the "Salaries and Stipend"
  // row (9,27,240); "VPP" row 8,23,091; no external consultant. Totals
  // 25,81,931 - the figure budget_pnl holds for Akshayam's direct_cost.
  GIFT: { team_lead: 831600, employee: 927240, vpp: 823091 },
};

/** One ledger posting behind a line's actual - what a drill-down shows. */
export interface TeamCostEntry {
  /** YYYY-MM-DD */
  date: string;
  /** the bill's narration, or the transaction type when it has none */
  description: string;
  /** the ledger's reference-number field, shown as its own Description column */
  reference: string;
  /** the vertical it is tagged to - shown in the whole-company view */
  verticalCode: string;
  /**
   * The GL account, but only when it is not the row's usual one (e.g. a stray
   * MCA Expenses posting in the External consultant row). Empty otherwise, so
   * the drill-down only names an account when it is worth a second look.
   */
  account: string;
  /** cost-positive rupees */
  amount: number;
}

export interface TeamCostRoleLine {
  role: TeamRole;
  label: string;
  hint?: string;
  /** the whole-year figure, hard-coded */
  annualBudget: number;
  /** annualBudget pro-rated to the page's own period */
  periodBudget: number;
  /** direct-cost postings for this vertical x role in that period, from the GL */
  periodActual: number;
  /** annualBudget pro-rated to the year to date */
  ytdBudget: number;
  /** direct-cost postings for this vertical x role, year to date */
  ytdActual: number;
  /** ytdBudget less ytdActual - a cost under budget is favourable */
  ytdVariance: number;
  /** ytdVariance as a percentage of ytdBudget, null when there is none */
  ytdVariancePct: number | null;
  /** the ledger postings behind periodActual, newest first */
  entries: TeamCostEntry[];
  /** the ledger postings behind ytdActual, newest first - the year to date's own postings, always */
  ytdEntries: TeamCostEntry[];
}

export interface TeamCostScope {
  /** the vertical this scope is, or null for the whole-company roll-up */
  verticalId: number | null;
  code: string;
  name: string;
  roles: TeamCostRoleLine[];
  annualBudget: number;
  periodBudget: number;
  periodActual: number;
  ytdBudget: number;
  ytdActual: number;
  ytdVariance: number;
  ytdVariancePct: number | null;
}

export interface TeamCostResult {
  /** true when the current entity has a hard-coded team-cost budget */
  hasData: boolean;
  /** whole months the period covers, out of the 12 in the year */
  monthsInPeriod: number;
  /** the whole-company roll-up - what the card shows by default */
  company: TeamCostScope;
  /** one per vertical that carries a budget or a ledger actual, for the picker */
  verticals: TeamCostScope[];
}

const pct = (variance: number, base: number): number | null =>
  base ? (variance / base) * 100 : null;

const emptyScope = (
  verticalId: number | null,
  code: string,
  name: string,
): TeamCostScope => ({
  verticalId,
  code,
  name,
  roles: TEAM_ROLES.map(({ key, label, hint }) => ({
    role: key,
    label,
    hint,
    annualBudget: 0,
    periodBudget: 0,
    periodActual: 0,
    ytdBudget: 0,
    ytdActual: 0,
    ytdVariance: 0,
    ytdVariancePct: null,
    entries: [],
    ytdEntries: [],
  })),
  annualBudget: 0,
  periodBudget: 0,
  periodActual: 0,
  ytdBudget: 0,
  ytdActual: 0,
  ytdVariance: 0,
  ytdVariancePct: null,
});

function rollUp(
  verticalId: number | null,
  code: string,
  name: string,
  roles: TeamCostRoleLine[],
): TeamCostScope {
  const annualBudget = roles.reduce((s, r) => s + r.annualBudget, 0);
  const periodBudget = roles.reduce((s, r) => s + r.periodBudget, 0);
  const periodActual = roles.reduce((s, r) => s + r.periodActual, 0);
  const ytdBudget = roles.reduce((s, r) => s + r.ytdBudget, 0);
  const ytdActual = roles.reduce((s, r) => s + r.ytdActual, 0);
  const ytdVariance = ytdBudget - ytdActual;
  return {
    verticalId,
    code,
    name,
    roles,
    annualBudget,
    periodBudget,
    periodActual,
    ytdBudget,
    ytdActual,
    ytdVariance,
    ytdVariancePct: pct(ytdVariance, ytdBudget),
  };
}

export async function buildTeamCost(opts: {
  entity: Entity;
  fyStartYear: number;
  /** the months being compared on, from the page's period picker */
  periodMonths: FyMonth[];
  /** the months from the start of the year to the ledger's latest complete month */
  ytdMonths: FyMonth[];
  /**
   * The statement's own Team cost budget - for the period, the year to date,
   * and the whole year. Both windows here are pro-rated on the same curve the
   * statement uses, so the card's totals tie to the "Team cost" line above it
   * rather than assuming an even twelfth a month.
   */
  statementBudget: { period: number; ytd: number; annual: number };
}): Promise<TeamCostResult> {
  const { entity, fyStartYear, periodMonths, ytdMonths, statementBudget } = opts;
  const monthsInPeriod = periodMonths.length;
  // The fraction of the year's budget that falls in each window, taken from
  // the statement so the two agree. Falls back to an even spread if the
  // statement carries no team-cost budget.
  const periodFraction =
    statementBudget.annual > 0
      ? statementBudget.period / statementBudget.annual
      : monthsInPeriod / 12;
  const ytdFraction =
    statementBudget.annual > 0
      ? statementBudget.ytd / statementBudget.annual
      : ytdMonths.length / 12;
  const prorateP = (annual: number) => annual * periodFraction;
  const prorateY = (annual: number) => annual * ytdFraction;

  // In scope, not just the picker list - so the group sees both companies'
  // verticals and a slice (RAJA) sees the two it is cut from.
  const verticals = await getVerticalsInScope(entity);
  if (verticals.every((v) => !TEAM_COST_ANNUAL_BUDGET[v.code])) {
    return {
      hasData: false,
      monthsInPeriod,
      company: emptyScope(null, "ALL", "Whole company"),
      verticals: [],
    };
  }

  const { start: fyStart, end: fyEnd } = fyBounds(fyStartYear, entity.fy_start_month);
  const periodKeys = new Set(periodMonths.map((m) => m.key));
  const ytdKeys = new Set(ytdMonths.map((m) => m.key));

  // Actuals from the ledger: every direct_cost posting for the whole year,
  // kept as its own row so a line can be drilled into and bucketed by month
  // for the two windows. credit - debit puts a cost negative, so it is
  // flipped to a positive magnitude - the same convention the P&L uses.
  const entryRows = await query<{
    vertical_id: number | null;
    vertical_code: string | null;
    account_name: string;
    month_key: string;
    txn_date: string;
    description: string | null;
    reference: string | null;
    txn_type: string | null;
    amount: number;
  }>(
    `select g.vertical_id,
            v.code as vertical_code,
            a.name as account_name,
            to_char(g.txn_date, 'YYYY-MM') as month_key,
            to_char(g.txn_date, 'YYYY-MM-DD') as txn_date,
            nullif(btrim(g.description), '') as description,
            nullif(btrim(g.reference), '')  as reference,
            g.txn_type,
            (g.debit - g.credit) as amount
       from gl_entries g
       join accounts a on a.id = g.account_id
       left join verticals v on v.id = g.vertical_id
      where g.entity_id = any($1::int[])
        and g.txn_date between $2 and $3
        and a.statement = 'pnl' and a.group_code = 'direct_cost'
        and not ($4::boolean and a.is_intercompany)
        and ($5::int[] is null or g.vertical_id = any($5::int[]))
      order by g.txn_date desc, g.id desc`,
    [entity.memberIds, fyStart, fyEnd, entity.consolidates, entity.verticalIds],
  );

  const usualAccounts = new Map(TEAM_ROLES.map((r) => [r.key, r.glAccounts]));
  const periodActualBy = new Map<string, number>();
  const ytdActualBy = new Map<string, number>();
  const entriesBy = new Map<string, TeamCostEntry[]>();
  const ytdEntriesBy = new Map<string, TeamCostEntry[]>();
  for (const r of entryRows) {
    if (r.vertical_id == null) continue;
    const role = ACCOUNT_ROLE[r.account_name] ?? FALLBACK_ROLE;
    const key = `${r.vertical_id}|${role}`;
    const amount = Number(r.amount);
    const inPeriod = periodKeys.has(r.month_key);
    const inYtd = ytdKeys.has(r.month_key);
    if (inPeriod) periodActualBy.set(key, (periodActualBy.get(key) ?? 0) + amount);
    if (inYtd) ytdActualBy.set(key, (ytdActualBy.get(key) ?? 0) + amount);
    const entry: TeamCostEntry = {
      date: r.txn_date,
      description: r.description ?? r.txn_type ?? "—",
      reference: r.reference ?? "",
      verticalCode: r.vertical_code ?? "—",
      account: usualAccounts.get(role)?.includes(r.account_name) ? "" : r.account_name,
      amount,
    };
    // The period's own postings are always shown behind a drill-down; the
    // year to date's own postings are kept separately, so a drill-down that
    // wants the whole year's story so far never loses it to a narrower filter.
    if (inPeriod) {
      const list = entriesBy.get(key) ?? [];
      list.push(entry);
      entriesBy.set(key, list);
    }
    if (inYtd) {
      const list = ytdEntriesBy.get(key) ?? [];
      list.push(entry);
      ytdEntriesBy.set(key, list);
    }
  }

  // A vertical earns a block if it carries a budget or has a ledger actual in
  // either window - so the whole-company total always ties to the statement.
  const shown = verticals.filter(
    (v) =>
      TEAM_COST_ANNUAL_BUDGET[v.code] ||
      TEAM_ROLES.some(
        ({ key }) => periodActualBy.has(`${v.id}|${key}`) || ytdActualBy.has(`${v.id}|${key}`),
      ),
  );

  const verticalScopes: TeamCostScope[] = shown.map((v) => {
    const table = TEAM_COST_ANNUAL_BUDGET[v.code] ?? {};
    const roles: TeamCostRoleLine[] = TEAM_ROLES.map(({ key, label, hint, budgetKeys }) => {
      const annualBudget = budgetKeys.reduce((s, bk) => s + (table[bk] ?? 0), 0);
      const periodBudget = prorateP(annualBudget);
      const ytdBudget = prorateY(annualBudget);
      const periodActual = periodActualBy.get(`${v.id}|${key}`) ?? 0;
      const ytdActual = ytdActualBy.get(`${v.id}|${key}`) ?? 0;
      const ytdVariance = ytdBudget - ytdActual;
      return {
        role: key,
        label,
        hint,
        annualBudget,
        periodBudget,
        periodActual,
        ytdBudget,
        ytdActual,
        ytdVariance,
        ytdVariancePct: pct(ytdVariance, ytdBudget),
        entries: entriesBy.get(`${v.id}|${key}`) ?? [],
        ytdEntries: ytdEntriesBy.get(`${v.id}|${key}`) ?? [],
      };
    });
    return rollUp(v.id, v.code, v.name, roles);
  });

  // The whole-company roll-up: each role summed across the vertical scopes,
  // with their drill-down entries merged and re-sorted newest first.
  const companyRoles: TeamCostRoleLine[] = TEAM_ROLES.map(({ key, label, hint }, i) => {
    const annualBudget = verticalScopes.reduce((s, sc) => s + sc.roles[i].annualBudget, 0);
    const periodBudget = verticalScopes.reduce((s, sc) => s + sc.roles[i].periodBudget, 0);
    const periodActual = verticalScopes.reduce((s, sc) => s + sc.roles[i].periodActual, 0);
    const ytdBudget = verticalScopes.reduce((s, sc) => s + sc.roles[i].ytdBudget, 0);
    const ytdActual = verticalScopes.reduce((s, sc) => s + sc.roles[i].ytdActual, 0);
    const ytdVariance = ytdBudget - ytdActual;
    const entries = verticalScopes
      .flatMap((sc) => sc.roles[i].entries)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    const ytdEntries = verticalScopes
      .flatMap((sc) => sc.roles[i].ytdEntries)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    return {
      role: key,
      label,
      hint,
      annualBudget,
      periodBudget,
      periodActual,
      ytdBudget,
      ytdActual,
      ytdVariance,
      ytdVariancePct: pct(ytdVariance, ytdBudget),
      entries,
      ytdEntries,
    };
  });

  return {
    hasData: true,
    monthsInPeriod,
    company: rollUp(null, "ALL", "Whole company", companyRoles),
    verticals: verticalScopes,
  };
}

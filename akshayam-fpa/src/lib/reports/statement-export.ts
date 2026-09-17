import type { Entity } from "@/lib/entity";
import { fyLabel, fyMonths, groupByQuarter, quarterLabel, type FyMonth } from "@/lib/period";
import { buildApportionment } from "@/lib/reports/apportionment";
import { BASIS_LABEL, HEAD_BASIS } from "@/lib/reports/apportionment";
import { buildBudgetVsActualPnl } from "@/lib/reports/budget-pnl";
import { buildEstablishmentDetail } from "@/lib/reports/establishment-detail";
import { buildExpenseDetail, type ExpenseDetailLine } from "@/lib/reports/expense-detail";
import {
  buildBalanceSheet,
  buildCashFlow,
  buildProfitAndLoss,
  type StatementResult,
} from "@/lib/reports/statements";
import { buildTeamCost } from "@/lib/reports/team-cost";
import { addSheet, createWorkbook, type SheetSpec } from "@/lib/reports/xlsx";

/**
 * The three statements and the budget pack, as workbooks.
 *
 * On screen a statement collapses to quarters and expands on click. A sheet
 * cannot do that, so it carries every month *and* every quarter side by side -
 * the reader can hide what they do not want, which is the one thing a
 * spreadsheet is better at than a web page.
 */

export type StatementKind = "pnl" | "balance-sheet" | "cash-flow" | "budget-vs-actual";

const TITLES: Record<StatementKind, string> = {
  pnl: "Profit and Loss",
  "balance-sheet": "Balance Sheet",
  "cash-flow": "Cash Flow",
  "budget-vs-actual": "Budget vs Actual",
};

export function statementTitle(kind: StatementKind): string {
  return TITLES[kind];
}

export function isStatementKind(value: string): value is StatementKind {
  return value in TITLES;
}

/**
 * Turn a statement into rows.
 *
 * `aggregate` is what a quarter or year column means. A P&L and a cash flow
 * add their months up; a balance sheet does not - three month-end positions do
 * not make a quarter, so those columns take the closing month instead. It is
 * the same rule the on-screen table follows, for the same reason.
 */
function statementSheet(
  statement: StatementResult,
  opts: {
    name: string;
    title: string;
    context: string[];
    aggregate: "sum" | "closing";
    /** lines whose own aggregation differs, e.g. opening and closing cash */
    perLine?: boolean;
  },
): SheetSpec {
  const { months } = statement;
  const quarters = groupByQuarter(months);

  const columns: SheetSpec["columns"] = [
    { header: "Particulars", type: "text" },
    ...months.map((m) => ({ header: m.label, type: "money" as const })),
    ...quarters.map((q) => ({
      header: quarterLabel(q.quarter, months),
      type: "money" as const,
    })),
    { header: opts.aggregate === "closing" ? "Year end" : "FY Total", type: "money", strong: true },
  ];

  const combine = (
    line: (typeof statement.lines)[number],
    keys: string[],
  ): number => {
    const how = (opts.perLine && line.columnAggregate) || (opts.aggregate === "closing" ? "last" : "sum");
    if (how === "last") return line.values[keys[keys.length - 1]] ?? 0;
    if (how === "first") return line.values[keys[0]] ?? 0;
    return keys.reduce((sum, k) => sum + (line.values[k] ?? 0), 0);
  };

  const emphasise: number[] = [];
  const rows = statement.lines.map((line, index) => {
    if (line.isSubtotal || line.level === 0) emphasise.push(index);
    const label = line.level === 1 ? `    ${line.name}` : line.name;
    return [
      label,
      // Sign is applied here, so the sheet reads the way the screen does: a
      // cost as a positive number on a line that subtracts.
      ...months.map((m) => combine(line, [m.key]) * line.sign),
      ...quarters.map((q) => combine(line, q.months.map((m) => m.key)) * line.sign),
      combine(line, months.map((m) => m.key)) * line.sign,
    ];
  });

  return {
    name: opts.name,
    title: opts.title,
    context: opts.context,
    columns,
    rows,
    emphasise,
    freezeColumns: 1,
  };
}

export async function buildStatementWorkbook(opts: {
  kind: StatementKind;
  entity: Entity;
  fyStartYear: number;
  verticalId?: number | null;
  verticalName?: string | null;
  /** the reporting-period window, when it is a sub-year range */
  window?: { start: string; end: string };
  /** balance-sheet "as of" date */
  asOf?: string;
  /** the whole months the period touches - the columns of the BvA sheet */
  periodMonths?: FyMonth[];
  /** the period's human label, for the sheet's context line */
  periodLabel?: string;
  /** the months from 1 April to the ledger's latest month, for the Other-expenses YTD columns */
  ytdMonths?: FyMonth[];
}) {
  const {
    kind,
    entity,
    fyStartYear,
    verticalId = null,
    verticalName = null,
    window,
    asOf,
    periodLabel,
  } = opts;
  const workbook = createWorkbook();
  const context = [entity.name, periodLabel ?? fyLabel(fyStartYear)];
  if (verticalName) context.push(verticalName);

  if (kind === "pnl") {
    const statement = await buildProfitAndLoss({ entity, fyStartYear, verticalId, window });
    addSheet(workbook, {
      ...statementSheet(statement, {
        name: "Profit and Loss",
        title: "Profit and Loss",
        context,
        aggregate: "sum",
      }),
    });
    return workbook;
  }

  if (kind === "balance-sheet") {
    const statement = await buildBalanceSheet({ entity, fyStartYear, asOf });
    addSheet(workbook, {
      ...statementSheet(statement, {
        name: "Balance Sheet",
        title: "Balance Sheet",
        context: [...context, "position at each period end"],
        aggregate: "closing",
      }),
    });
    return workbook;
  }

  if (kind === "cash-flow") {
    const statement = await buildCashFlow({ entity, fyStartYear, window });
    addSheet(workbook, {
      ...statementSheet(statement, {
        name: "Cash Flow",
        title: "Cash Flow — indirect method",
        context: [
          ...context,
          statement.reconciles
            ? "reconciles to the bank accounts"
            : `does NOT reconcile — out by ${Math.round(Math.abs(statement.gap))}`,
        ],
        aggregate: "sum",
        // Opening and closing cash are positions inside a flow statement.
        perLine: true,
      }),
    });
    return workbook;
  }

  // ---------- budget vs actual ----------

  // A slice - a team lead's own single-vertical book, or Raja's GIFT+AIF cut -
  // has no budgeted P&L of its own, the same reason the page holds the
  // statement, common-size and apportionment cards back for one. Team cost
  // still applies: its budget is hard-coded per vertical, so it works for any
  // cut of the verticals, slice included.
  const isSlice = entity.verticalIds !== null;
  const months = opts.periodMonths ?? fyMonths(fyStartYear);
  const allMonths = fyMonths(fyStartYear);
  const ytdMonths = opts.ytdMonths ?? months;

  let teamCostBudget = { period: 0, ytd: 0, annual: 0 };

  if (!isSlice) {
    const statement = await buildBudgetVsActualPnl({ entity, fyStartYear, verticalId, window });

    addSheet(workbook, {
      name: "Budget vs Actual",
      title: "Budget vs Actual",
      context: [...context, "budget and actual are the same definition on both sides"],
      columns: [
        { header: "Particulars", type: "text" },
        ...months.flatMap((m) => [
          { header: `${m.label} Budget`, type: "money" as const },
          { header: `${m.label} Actual`, type: "money" as const },
        ]),
        { header: "FY Budget", type: "money", strong: true },
        { header: "FY Actual", type: "money", strong: true },
        { header: "Variance", type: "money" },
        { header: "% Achievement", type: "percent" },
      ],
      rows: statement.lines.map((line) => {
        const budget = months.reduce((s, m) => s + line.budget[m.key], 0);
        const actual = months.reduce((s, m) => s + line.actual[m.key], 0);
        return [
          line.sign === -1 && !line.isSubtotal ? `Less: ${line.name}` : line.name,
          ...months.flatMap((m) => [line.budget[m.key], line.actual[m.key]]),
          budget,
          actual,
          // Favourable means more revenue or less cost, so the sign follows the
          // line rather than a blind subtraction.
          line.sign === -1 ? budget - actual : actual - budget,
          budget === 0 ? null : (actual / budget) * 100,
        ];
      }),
      emphasise: statement.lines.map((l, i) => (l.isSubtotal ? i : -1)).filter((i) => i >= 0),
      freezeColumns: 1,
    });

    const revenue = statement.lines.find((l) => l.code === "revenue")!;
    const shown = months.filter((m) => Math.abs(revenue.actual[m.key]) > 0.5);
    const share = (value: number, base: number) => (Math.abs(base) < 0.5 ? null : (value / base) * 100);

    addSheet(workbook, {
      name: "Common size",
      title: "Common-size P&L by month",
      context: [...context, "each line as a percentage of the same month's revenue"],
      columns: [
        { header: "Particulars", type: "text" },
        ...shown.map((m) => ({ header: m.label, type: "percent" as const })),
        { header: "Year to date", type: "percent", strong: true },
        { header: "Budget FY", type: "percent" },
      ],
      rows: statement.lines.map((line) => [
        line.name,
        ...shown.map((m) => share(line.actual[m.key], revenue.actual[m.key])),
        share(
          months.reduce((s, m) => s + line.actual[m.key], 0),
          months.reduce((s, m) => s + revenue.actual[m.key], 0),
        ),
        share(
          months.reduce((s, m) => s + line.budget[m.key], 0),
          months.reduce((s, m) => s + revenue.budget[m.key], 0),
        ),
      ]),
      emphasise: statement.lines.map((l, i) => (l.isSubtotal ? i : -1)).filter((i) => i >= 0),
      freezeColumns: 1,
    });

    // One sheet per quarter that has something to apportion.
    for (const quarter of [1, 2, 3, 4] as const) {
      const a = await buildApportionment({ entity, fyStartYear, quarter });
      if (!a.applicable) continue;

      const rows: (string | number | null)[][] = [
        ["Head count", ...a.verticals.map((v) => v.heads), a.verticals.reduce((s, v) => s + v.heads, 0)],
        ["Revenue", ...a.verticals.map((v) => v.revenue), a.verticals.reduce((s, v) => s + v.revenue, 0)],
        [
          "Direct cost",
          ...a.verticals.map((v) => v.directCost),
          a.verticals.reduce((s, v) => s + v.directCost, 0),
        ],
        ...a.heads.map((h) => [
          `    ${h}  (${BASIS_LABEL[HEAD_BASIS[h]]})`,
          ...a.verticals.map((v) => v.apportioned[h] ?? null),
          a.pool[h] ?? 0,
        ]),
        [
          "Apportioned common cost",
          ...a.verticals.map((v) => v.apportionedTotal),
          a.poolTotal,
        ],
        [
          "Total cost",
          ...a.verticals.map((v) => v.totalCost),
          a.verticals.reduce((s, v) => s + v.totalCost, 0),
        ],
        [
          "Contribution",
          ...a.verticals.map((v) => v.contribution),
          a.verticals.reduce((s, v) => s + v.contribution, 0),
        ],
      ];

      addSheet(workbook, {
        name: `Apportionment ${a.label.slice(0, 2)}`,
        title: `Cost apportionment — ${a.label}`,
        context: [
          ...context,
          `${a.start} to ${a.end}`,
          "on the budget's own bases · contribution is the VPP line",
        ],
        columns: [
          { header: "Particulars", type: "text" },
          ...a.verticals.map((v) => ({ header: v.label, type: "money" as const })),
          { header: "Total", type: "money", strong: true },
        ],
        // Head count is a count, not money; it is the only row that differs and
        // Excel takes the format from the column, so it is left unformatted
        // rather than given a column type the other rows would inherit.
        rows,
        emphasise: [0, rows.length - 3, rows.length - 2, rows.length - 1],
        rule: [3, rows.length - 3],
        freezeColumns: 1,
      });
    }

    // The statement's own Team cost budget, for the sheet's period and for the
    // whole year - proration follows the same curve the statement uses, the
    // same rule the on-screen card applies, so the two never disagree.
    const teamCostLine = statement.lines.find((l) => l.code === "direct_cost");
    const budgetOver = (ms: FyMonth[]) => ms.reduce((s, m) => s + (teamCostLine?.budget[m.key] ?? 0), 0);
    teamCostBudget = {
      period: budgetOver(months),
      ytd: budgetOver(ytdMonths),
      annual: budgetOver(allMonths),
    };
  }

  const teamCost = await buildTeamCost({
    entity,
    fyStartYear,
    periodMonths: months,
    ytdMonths,
    statementBudget: teamCostBudget,
  });
  if (teamCost.hasData) {
    // The sheet keeps the period-only shape it always had - the on-screen
    // card's YTD split is a separate change, not asked for in the export.
    const periodVariance = (budget: number, actual: number) => budget - actual;
    const periodPct = (budget: number, actual: number) =>
      budget ? (periodVariance(budget, actual) / budget) * 100 : null;
    const roleRows = teamCost.company.roles.map((r) => [
      r.label,
      r.annualBudget,
      r.periodBudget,
      r.periodActual,
      periodVariance(r.periodBudget, r.periodActual),
      periodPct(r.periodBudget, r.periodActual),
    ]);
    const totalRow = [
      `Team cost — ${teamCost.company.name}`,
      teamCost.company.annualBudget,
      teamCost.company.periodBudget,
      teamCost.company.periodActual,
      periodVariance(teamCost.company.periodBudget, teamCost.company.periodActual),
      periodPct(teamCost.company.periodBudget, teamCost.company.periodActual),
    ];
    addSheet(workbook, {
      name: "Team cost",
      title: "Team cost — budget vs actual",
      context: [...context, "whole company · budget hard-coded from the plan"],
      columns: [
        { header: "Particulars", type: "text" },
        { header: "Annual budget", type: "money" },
        { header: "Period budget", type: "money" },
        { header: "Actual", type: "money" },
        { header: "Variance", type: "money" },
        { header: "% Variance", type: "percent" },
      ],
      rows: [...roleRows, totalRow],
      emphasise: [roleRows.length],
      rule: [roleRows.length],
      freezeColumns: 1,
    });
  }

  if (!isSlice) {
    const [establishment, expenseDetail] = await Promise.all([
      buildEstablishmentDetail({
        entity,
        fyStartYear,
        periodMonths: months,
        ytdMonths,
      }),
      buildExpenseDetail({ entity, fyStartYear, periodMonths: months, ytdMonths }),
    ]);

    if (establishment.hasData) {
      // The sheet keeps the period-only shape it always had - the on-screen
      // card's YTD split is a separate change, not asked for in the export.
      const periodVariance = (budget: number, actual: number) => budget - actual;
      const periodPct = (budget: number, actual: number) =>
        budget ? (periodVariance(budget, actual) / budget) * 100 : null;
      const rows = establishment.lines.map((l) => [
        l.label,
        l.isActualOnly ? null : l.annualBudget,
        l.isActualOnly ? null : l.periodBudget,
        l.periodActual,
        l.isActualOnly ? null : periodVariance(l.periodBudget, l.periodActual),
        l.isActualOnly ? null : periodPct(l.periodBudget, l.periodActual),
      ]);
      const totalVariance = periodVariance(
        establishment.totals.periodBudget,
        establishment.totals.periodActual,
      );
      const totalPct = periodPct(establishment.totals.periodBudget, establishment.totals.periodActual);
      addSheet(workbook, {
        name: "Establishment cost",
        title: "Establishment cost — budget vs actual",
        context: [...context, "budget is the office schedule, spread evenly"],
        columns: [
          { header: "Particulars", type: "text" },
          { header: "Annual budget", type: "money" },
          { header: "Period budget", type: "money" },
          { header: "Actual", type: "money" },
          { header: "Variance", type: "money" },
          { header: "% Variance", type: "percent" },
        ],
        rows: [
          ...rows,
          [
            "Establishment cost",
            null,
            establishment.totals.periodBudget,
            establishment.totals.periodActual,
            totalVariance,
            totalPct,
          ],
        ],
        emphasise: [rows.length],
        rule: [rows.length],
        freezeColumns: 1,
      });
    }

    if (expenseDetail.hasDetail) {
      addSheet(workbook, otherExpensesSheet(expenseDetail.lines, expenseDetail.totals, context));
    }
  }

  // A slice with no hard-coded Team cost budget of its own (e.g. a vertical
  // the plan carries at nil) would otherwise leave the workbook with no sheet
  // at all - a file Excel refuses to open.
  if (workbook.worksheets.length === 0) {
    addSheet(workbook, {
      name: "Budget vs Actual",
      title: "Budget vs Actual",
      context: [...context, "nothing budgeted for this company or vertical"],
      columns: [{ header: "Particulars", type: "text" }],
      rows: [],
    });
  }

  return workbook;
}

/**
 * The Other-expenses breakdown, grouped the way the on-screen card is: one
 * bold row per head (its Period and YTD figures summed across its lines),
 * the lines themselves indented beneath. A single-line head - the sheet's
 * heads that carry no breakdown - is just the one row, same as the screen.
 */
function otherExpensesSheet(
  lines: ExpenseDetailLine[],
  totals: {
    periodBudget: number;
    periodActual: number;
    ytdBudget: number;
    ytdActual: number;
    ytdVariance: number;
    ytdVariancePct: number | null;
  },
  context: string[],
): SheetSpec {
  const groups: { head: string; lines: ExpenseDetailLine[] }[] = [];
  const indexOf = new Map<string, number>();
  for (const line of lines) {
    if (!indexOf.has(line.head)) {
      indexOf.set(line.head, groups.length);
      groups.push({ head: line.head, lines: [] });
    }
    groups[indexOf.get(line.head)!].lines.push(line);
  }

  const signed = (l: ExpenseDetailLine, actual: number) => (l.isDeduction ? -actual : actual);
  const rows: (string | number | null)[][] = [];
  const emphasise: number[] = [];
  const rule: number[] = [];

  for (const g of groups) {
    const asLine = (l: ExpenseDetailLine, label: string) => [
      label,
      l.isActualOnly ? null : l.periodBudget,
      l.periodActual,
      l.isActualOnly ? null : l.ytdBudget,
      l.ytdActual,
      l.isActualOnly ? null : l.ytdVariance,
      l.isActualOnly ? null : l.ytdVariancePct,
    ];

    if (g.lines.length === 1 && g.lines[0].isHeadOnly) {
      rows.push(asLine(g.lines[0], g.lines[0].label));
      continue;
    }

    const sums = g.lines.reduce(
      (acc, l) => {
        const periodActual = signed(l, l.periodActual);
        const ytdActual = signed(l, l.ytdActual);
        return {
          periodBudget: acc.periodBudget + l.periodBudget,
          periodActual: acc.periodActual + periodActual,
          ytdBudget: acc.ytdBudget + l.ytdBudget,
          ytdActual: acc.ytdActual + ytdActual,
          ytdVariance: acc.ytdVariance + (l.ytdBudget - ytdActual),
        };
      },
      { periodBudget: 0, periodActual: 0, ytdBudget: 0, ytdActual: 0, ytdVariance: 0 },
    );
    emphasise.push(rows.length);
    rule.push(rows.length);
    rows.push([
      g.head,
      sums.periodBudget,
      sums.periodActual,
      sums.ytdBudget,
      sums.ytdActual,
      sums.ytdVariance,
      sums.ytdBudget ? (sums.ytdVariance / sums.ytdBudget) * 100 : null,
    ]);
    for (const l of g.lines) rows.push(asLine(l, `    ${l.label}`));
  }

  emphasise.push(rows.length);
  rule.push(rows.length);
  rows.push([
    "Other expenses",
    totals.periodBudget,
    totals.periodActual,
    totals.ytdBudget,
    totals.ytdActual,
    totals.ytdVariance,
    totals.ytdVariancePct,
  ]);

  return {
    name: "Other expenses",
    title: "Other expenses — what it is made of",
    context: [...context, "grouped by head; YTD is always 1 April to the ledger's latest month"],
    columns: [
      { header: "Particulars", type: "text" },
      { header: "Period budget", type: "money" },
      { header: "Period actuals", type: "money" },
      { header: "YTD budget", type: "money" },
      { header: "YTD actuals", type: "money" },
      { header: "Variance (YTD)", type: "money" },
      { header: "% (YTD)", type: "percent" },
    ],
    rows,
    emphasise,
    rule,
    freezeColumns: 1,
  };
}

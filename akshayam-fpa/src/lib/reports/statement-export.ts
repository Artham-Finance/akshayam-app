import type { Entity } from "@/lib/entity";
import { fyLabel, fyMonths, groupByQuarter, quarterLabel } from "@/lib/period";
import { buildApportionment } from "@/lib/reports/apportionment";
import { BASIS_LABEL, HEAD_BASIS } from "@/lib/reports/apportionment";
import { buildBudgetVsActualPnl } from "@/lib/reports/budget-pnl";
import {
  buildBalanceSheet,
  buildCashFlow,
  buildProfitAndLoss,
  type StatementResult,
} from "@/lib/reports/statements";
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
}) {
  const { kind, entity, fyStartYear, verticalId = null, verticalName = null } = opts;
  const workbook = createWorkbook();
  const context = [entity.name, fyLabel(fyStartYear)];
  if (verticalName) context.push(verticalName);

  if (kind === "pnl") {
    const statement = await buildProfitAndLoss({ entity, fyStartYear, verticalId });
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
    const statement = await buildBalanceSheet({ entity, fyStartYear });
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
    const statement = await buildCashFlow({ entity, fyStartYear });
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

  // ---------- budget vs actual: three sheets ----------

  const months = fyMonths(fyStartYear);
  const statement = await buildBudgetVsActualPnl({ entity, fyStartYear, verticalId });

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

  return workbook;
}

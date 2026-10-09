import type ExcelJS from "exceljs";
import type { Entity } from "@/lib/entity";
import { fyLabel, fyMonths, groupByQuarter, quarterLabel, type FyMonth } from "@/lib/period";
import {
  buildVerticalCostApportionment,
  type ApportionedVerticalCost,
} from "@/lib/reports/vertical-cost-apportionment";
import { createWorkbook } from "@/lib/reports/xlsx";

/**
 * The vertical-wise P&L after cost apportionment, month by month, for both ways
 * the pooled cost is spread.
 *
 * On screen the card is struck a quarter (or one month) at a time, with a second
 * card beside it for the comparison on company-wide head count. This is the same
 * engine run once for each month of the year to date, so a month's figures are
 * exactly what the card shows when that month is picked - head count struck on
 * that month alone - laid side by side with each quarter's total and the year to
 * date at the end.
 *
 * Two sheets, one for each way of spreading Common's and ACC & HRCM's cost:
 *   - on the head count of the six verticals, the figures VPP is struck on
 *   - on the company's whole head count (the comparison), which leaves part of the
 *     pooled cost uncharged to any of the six; that part is shown on its own row,
 *     so the six verticals plus it add back to the whole pool
 *
 * A quarter or year-to-date column is the sum of its months (a head count, the
 * average) - each month spread on its own head count, then added - so the months
 * always add to the quarter. The card's own quarter view strikes the head count on
 * the quarter's average instead, and can differ slightly. Reimbursement income and
 * expense are left out throughout, as they are on the card.
 */

const NAVY = "FF16263C";
const RULE = "FFD9DEE5";
const GREY = "FF6B7684";
const SECTION = "FFEDF1F6";
const RS = "##,##,##0;(##,##,##0);\"-\"";

function letter(n: number): string {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

type Scenario = "six" | "wide";

interface Metric {
  key: string;
  label: string;
  /** a count of people, not money - averaged rather than added up */
  isCount?: boolean;
  /** derived from the rows above it - a formula, not a figure */
  formula?: "totalCost" | "contribution";
}

const METRICS: Metric[] = [
  { key: "heads", label: "Head count", isCount: true },
  { key: "revenue", label: "Revenue" },
  { key: "directTeamCost", label: "Direct team cost" },
  { key: "directOverheads", label: "Direct overheads" },
  { key: "otherIncome", label: "Other income (a credit)" },
  { key: "common", label: "Common cost — apportioned" },
  { key: "accHrcm", label: "ACC and HRCM cost — apportioned" },
  { key: "totalCost", label: "Total cost", formula: "totalCost" },
  { key: "contribution", label: "Contribution", formula: "contribution" },
];

function valueOf(v: ApportionedVerticalCost, key: string, scenario: Scenario): number {
  switch (key) {
    case "heads": return v.heads;
    case "revenue": return v.revenue;
    case "directTeamCost": return v.directTeamCost;
    case "directOverheads": return v.directOverheads;
    case "otherIncome": return v.otherIncome;
    case "common": return scenario === "six" ? v.commonApportioned : v.commonApportionedWide;
    case "accHrcm": return scenario === "six" ? v.accHrcmApportioned : v.accHrcmApportionedWide;
    default: return 0;
  }
}

export interface ApportionmentWorkbookInput {
  entity: Entity;
  fyStartYear: number;
  /** the last date to include - months starting on or before it are columns */
  through: string;
  /** vertical keys to list; null for all six */
  only: Set<string> | null;
}

export async function buildApportionmentWorkbook(
  input: ApportionmentWorkbookInput,
): Promise<ExcelJS.Workbook | null> {
  const { entity, fyStartYear } = input;
  const months: FyMonth[] = fyMonths(fyStartYear, entity.fy_start_month).filter(
    (m) => m.start <= input.through,
  );
  if (months.length === 0) return null;

  const results = await Promise.all(
    months.map((m) =>
      buildVerticalCostApportionment({ entity, fyStartYear, quarter: m.quarter, month: m.key }),
    ),
  );
  if (results.every((r) => r.verticals.length === 0)) return null;

  const keys = results[0].verticals.map((v) => ({ key: v.key, label: v.label }));
  const listed = input.only ? keys.filter((k) => input.only!.has(k.key)) : keys;
  const showTotal = !input.only; // a slice is shown its own verticals only
  const quarters = groupByQuarter(months);

  const workbook = createWorkbook();
  workbook.calcProperties.fullCalcOnLoad = true;

  const monthCol = (i: number) => 2 + i; // B onward
  const quarterCol = (i: number) => 2 + months.length + i;
  const ytdCol = 2 + months.length + quarters.length;
  const lastCol = ytdCol;

  for (const scenario of ["six", "wide"] as Scenario[]) {
    const sheet = workbook.addWorksheet(scenario === "six" ? "Head count of the six" : "Company-wide head count");
    sheet.columns = [
      { width: 38 },
      ...months.map(() => ({ width: 13 })),
      ...quarters.map(() => ({ width: 14 })),
      { width: 15 },
    ];

    const title = sheet.addRow([
      `Vertical-wise P&L after cost apportionment — ${scenario === "six" ? "on the head count of the six verticals" : "on the company's whole head count (comparison)"}`,
    ]);
    title.font = { bold: true, size: 14, color: { argb: NAVY } };
    sheet.addRow([[entity.name, fyLabel(fyStartYear), "in rupees"].join("  ·  ")]).font = {
      size: 10,
      color: { argb: GREY },
    };
    sheet.addRow([
      scenario === "six"
        ? "Common's cost and ACC and HRCM's cost are each spread on head count across the six verticals - the basis VPP is struck on. Each month on its own head count; quarter and year-to-date columns are the sum of their months (head count, the average)."
        : "The same pools spread on the company's whole head count, so part of each pool sits on heads outside the six and is not charged to any of them - shown on its own row at the foot. A comparison, not the VPP basis. Each month on its own head count; quarter and year-to-date columns are the sum of their months.",
    ]).font = { size: 10, italic: true, color: { argb: GREY } };
    sheet.addRow([
      "Reimbursement income and expense are left out of every figure, as on the card. Other income is a credit and so reduces total cost; Direct overheads includes OSB expenses.",
    ]).font = { size: 10, italic: true, color: { argb: GREY } };
    sheet.addRow([]);

    const header = sheet.addRow([
      "Particulars",
      ...months.map((m) => m.label),
      ...quarters.map((q) => quarterLabel(q.quarter, months)),
      "YTD total",
    ]);
    header.height = 26;
    header.eachCell((cell, i) => {
      cell.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
      cell.alignment = { vertical: "middle", horizontal: i === 1 ? "left" : "right" };
    });
    sheet.views = [{ state: "frozen", xSplit: 1, ySplit: header.number }];

    // month figures per vertical per metric
    const figure = (vertKey: string, metric: string, mi: number) => {
      const v = results[mi].verticals.find((x) => x.key === vertKey);
      return v ? valueOf(v, metric, scenario) : 0;
    };

    /**
     * Writes one block of rows - a header, then the nine metrics - for a vertical,
     * or for the total across the verticals. `cellFor(metric, mi)` gives a month's
     * figure, or null where the cell is built from the rows above.
     */
    const rowOf: Record<string, Record<string, number>> = {};
    const writeBlock = (
      id: string,
      label: string,
      monthValue: (metric: string, mi: number) => number | { formula: string; result: number },
    ) => {
      const head = sheet.addRow([label]);
      head.font = { bold: true, color: { argb: NAVY } };
      head.eachCell({ includeEmpty: true }, (cell, i) => {
        if (i <= lastCol) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SECTION } };
      });
      rowOf[id] = {};

      const resultOf = new Map<string, number[]>(); // metric -> month results, for the cached values

      for (const metric of METRICS) {
        const rowNo = sheet.rowCount + 1;
        rowOf[id][metric.key] = rowNo;
        const cells: (string | number | { formula: string; result?: number })[] = [`    ${metric.label}`];
        const monthResults: number[] = [];

        // month cells
        months.forEach((_m, mi) => {
          const col = letter(monthCol(mi));
          if (metric.formula === "totalCost") {
            const first = rowOf[id].directTeamCost;
            const last = rowOf[id].accHrcm;
            const result = (["directTeamCost", "directOverheads", "otherIncome", "common", "accHrcm"] as const).reduce(
              (s, k) => s + (resultOf.get(k)?.[mi] ?? 0),
              0,
            );
            monthResults.push(result);
            cells.push({ formula: `SUM(${col}${first}:${col}${last})`, result });
          } else if (metric.formula === "contribution") {
            const result = (resultOf.get("revenue")?.[mi] ?? 0) - (resultOf.get("totalCost")?.[mi] ?? 0);
            monthResults.push(result);
            cells.push({
              formula: `${col}${rowOf[id].revenue}-${col}${rowOf[id].totalCost}`,
              result,
            });
          } else {
            const v = monthValue(metric.key, mi);
            if (typeof v === "number") {
              monthResults.push(v);
              cells.push(v);
            } else {
              monthResults.push(v.result);
              cells.push(v);
            }
          }
        });
        resultOf.set(metric.key, monthResults);

        // quarter and year-to-date columns
        const aggregate = (from: number, to: number) => {
          const a = `${letter(monthCol(from))}${rowNo}`;
          const b = `${letter(monthCol(to))}${rowNo}`;
          const slice = monthResults.slice(from, to + 1);
          return metric.isCount
            ? { formula: `AVERAGE(${a}:${b})`, result: slice.reduce((s, x) => s + x, 0) / Math.max(slice.length, 1) }
            : { formula: `SUM(${a}:${b})`, result: slice.reduce((s, x) => s + x, 0) };
        };
        let offset = 0;
        for (const q of quarters) {
          cells.push(aggregate(offset, offset + q.months.length - 1));
          offset += q.months.length;
        }
        cells.push(aggregate(0, months.length - 1));

        const row = sheet.addRow(cells);
        row.eachCell({ includeEmpty: true }, (cell, i) => {
          if (i === 1) return;
          cell.numFmt = metric.isCount ? "0.00" : RS;
          cell.border = { bottom: { style: "hair", color: { argb: RULE } } };
        });
        if (metric.formula) row.font = { bold: true };
        if (metric.key === "contribution") {
          row.eachCell({ includeEmpty: true }, (cell) => {
            cell.border = { top: { style: "thin", color: { argb: NAVY } }, bottom: { style: "thin", color: { argb: NAVY } } };
          });
        }
      }

      sheet.addRow([]);
    };

    // each vertical
    for (const k of listed) {
      writeBlock(k.key, k.label, (metric, mi) => figure(k.key, metric, mi));
    }

    // the six together
    if (showTotal) {
      const ids = listed.map((k) => k.key);
      const sumMetric = (metric: string, mi: number) => {
        const col = letter(monthCol(mi));
        const refs = ids.map((id) => `${col}${rowOf[id][metric]}`);
        const result = ids.reduce((s, id) => s + figure(id, metric, mi), 0);
        return { formula: refs.join("+"), result };
      };
      writeBlock("TOTAL", "Total — the six verticals", (metric, mi) => sumMetric(metric, mi));

      if (scenario === "wide") {
        const unalloc = (mi: number) => results[mi].wide.commonUnapportioned + results[mi].wide.accHrcmUnapportioned;
        const rowNo = sheet.rowCount + 1;
        const cells: (string | number | { formula: string; result?: number })[] = [
          "Cost not charged to any of the six (sits on heads outside them)",
          ...months.map((_m, mi) => unalloc(mi)),
        ];
        let offset = 0;
        for (const q of quarters) {
          const a = `${letter(monthCol(offset))}${rowNo}`;
          const b = `${letter(monthCol(offset + q.months.length - 1))}${rowNo}`;
          cells.push({
            formula: `SUM(${a}:${b})`,
            result: months.slice(offset, offset + q.months.length).reduce((s, _m, j) => s + unalloc(offset + j), 0),
          });
          offset += q.months.length;
        }
        cells.push({
          formula: `SUM(${letter(monthCol(0))}${rowNo}:${letter(monthCol(months.length - 1))}${rowNo})`,
          result: months.reduce((s, _m, mi) => s + unalloc(mi), 0),
        });
        const row = sheet.addRow(cells);
        row.font = { bold: true };
        row.eachCell({ includeEmpty: true }, (cell, i) => {
          if (i > 1) cell.numFmt = RS;
        });
      }
    }
  }

  return workbook;
}

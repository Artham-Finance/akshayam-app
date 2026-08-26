import ExcelJS from "exceljs";

/**
 * Writing a report into a workbook.
 *
 * Every export in the app goes through here so a downloaded sheet looks the
 * same whichever page produced it, and - more to the point - so the *rules*
 * are the same: figures land as real numbers and dates as real dates, a header
 * block records what the sheet is and where it came from, and the header row
 * freezes. A file that has to be cleaned up before it can be sorted is not
 * really an export.
 */

export type CellType = "text" | "money" | "percent" | "date" | "days" | "int";

export interface SheetColumn {
  header: string;
  type: CellType;
  /** the column the reader came for */
  strong?: boolean;
}

export interface SheetSpec {
  /** tab name; Excel caps it at 31 characters and forbids some punctuation */
  name: string;
  title: string;
  /** the context line under the title: company, period, filters */
  context: string[];
  columns: SheetColumn[];
  rows: (string | number | null)[][];
  /** row indexes to set in bold - subtotals, and the total row */
  emphasise?: number[];
  /** draw a rule above these rows, where a section ends */
  rule?: number[];
  /** add a totals row summing every money column */
  totals?: boolean;
  /** freeze this many leading columns as well as the header */
  freezeColumns?: number;
}

const NAVY = "FF16263C";
const RULE = "FFD9DEE5";
const MONEY = "##,##,##0.00;(##,##,##0.00)";

/** Excel forbids these in a tab name, and caps the length at 31. */
const sheetName = (name: string) => name.replace(/[*?:\\/[\]]/g, "").slice(0, 31);

export function createWorkbook(): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Group Management Reporting";
  workbook.created = new Date();
  return workbook;
}

export function addSheet(workbook: ExcelJS.Workbook, spec: SheetSpec): ExcelJS.Worksheet {
  const sheet = workbook.addWorksheet(sheetName(spec.name));
  const width = Math.max(spec.columns.length, 1);

  const title = sheet.addRow([spec.title]);
  title.font = { bold: true, size: 14, color: { argb: NAVY } };
  sheet.mergeCells(title.number, 1, title.number, width);

  if (spec.context.length > 0) {
    const sub = sheet.addRow([spec.context.join("  ·  ")]);
    sub.font = { size: 10, color: { argb: "FF6B7684" } };
    sheet.mergeCells(sub.number, 1, sub.number, width);
  }
  sheet.addRow([]);

  const header = sheet.addRow(spec.columns.map((c) => c.header));
  header.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
  header.alignment = { vertical: "middle", wrapText: true };
  header.eachCell((cell, i) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    cell.alignment = {
      vertical: "middle",
      wrapText: true,
      horizontal: spec.columns[i - 1]?.type === "text" ? "left" : "right",
    };
  });
  header.height = 26;

  const emphasise = new Set(spec.emphasise ?? []);
  const rules = new Set(spec.rule ?? []);

  spec.rows.forEach((row, index) => {
    const added = sheet.addRow(
      row.map((value, i) => {
        // A date arrives as YYYY-MM-DD and must be built at UTC midnight:
        // ExcelJS converts using the UTC parts, so a local-midnight date lands
        // hours early and Excel shows the day before.
        if (spec.columns[i]?.type === "date" && typeof value === "string") {
          const [y, m, d] = value.split("-").map(Number);
          return y ? new Date(Date.UTC(y, m - 1, d)) : null;
        }
        return value;
      }),
    );

    const bold = emphasise.has(index);
    added.eachCell({ includeEmpty: true }, (cell, i) => {
      const column = spec.columns[i - 1];
      if (!column) return;
      cell.border = {
        bottom: { style: "hair", color: { argb: RULE } },
        ...(rules.has(index) ? { top: { style: "thin", color: { argb: NAVY } } } : {}),
      };
      if (bold) cell.font = { bold: true };
      switch (column.type) {
        case "money":
          cell.numFmt = MONEY;
          break;
        case "percent":
          cell.numFmt = '0.00"%"';
          break;
        case "date":
          cell.numFmt = "dd-mmm-yyyy";
          break;
        case "days":
          cell.numFmt = '0" d"';
          break;
        case "int":
          cell.numFmt = "0";
          break;
      }
    });
  });

  if (spec.totals && spec.rows.length > 0) {
    const cells: (string | number | null)[] = new Array(width).fill(null);
    cells[0] = "Total";
    spec.columns.forEach((column, i) => {
      if (column.type !== "money") return;
      cells[i] = spec.rows.reduce((sum, r) => sum + (Number(r[i]) || 0), 0);
    });
    const totals = sheet.addRow(cells);
    totals.font = { bold: true };
    totals.eachCell({ includeEmpty: true }, (cell, i) => {
      cell.border = { top: { style: "thin", color: { argb: NAVY } } };
      if (spec.columns[i - 1]?.type === "money") cell.numFmt = MONEY;
    });
  }

  spec.columns.forEach((column, i) => {
    const longest = spec.rows.reduce(
      (max, r) => Math.max(max, String(r[i] ?? "").length),
      Math.min(column.header.length, 18),
    );
    sheet.getColumn(i + 1).width = Math.min(Math.max(longest + 3, 11), 52);
  });

  sheet.views = [
    { state: "frozen", ySplit: header.number, xSplit: spec.freezeColumns ?? 0 },
  ];
  return sheet;
}

/** A filename Windows will accept, stamped with the day it was produced. */
export function exportFilename(entityName: string, title: string): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return `${entityName} - ${title} - ${stamp}.xlsx`.replace(/[\\/:*?"<>|]/g, "-");
}

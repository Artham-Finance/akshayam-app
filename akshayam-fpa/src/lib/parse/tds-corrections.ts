import type ExcelJS from "exceljs";
import { normaliseFy } from "@/lib/tds-corrections";
import { normaliseHeader, readWorkbook } from "./workbook";

/**
 * The TDS corrections sheet: a hand-kept list of one-off changes the client asks for, each
 * given as a line of instruction and a small table beneath it, for example
 *
 *   1. These customers are shifted from GADD to ECM and RRG. Give effect in the TDS sheet ...
 *   Customer | Tfd from | Tfd to
 *   Tidel Neo | Ekta - GADD | Vasudharini - ECM
 *
 * The sheet only ever grows: new rows under the table, or a new numbered instruction with its
 * own table further down. So it is read as a whole, every table in it, and the list is
 * replaced by it on every upload. A row needs the customer and the two verticals; a "Year"
 * column is optional and, when present, limits the row to that year.
 */

export interface TdsCorrectionRow {
  customer: string;
  /** the vertical as written ("Ekta - GADD"); resolved against the company's verticals on commit */
  from: string;
  to: string;
  /** "FY24-25" when the row names a year, else null: every year the customer is held under `from` */
  fy: string | null;
  /** the line of instruction above the table, for reference */
  instruction: string | null;
  /** the sheet row it was read from */
  sheetRow: number;
}

export interface TdsCorrectionParseResult {
  rows: TdsCorrectionRow[];
  warnings: string[];
  detected: { sheetName: string; headerRow: number; columns: string[] };
}

function text(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    if ("result" in v && v.result !== undefined && v.result !== null) return String(v.result).trim();
    if ("richText" in v && Array.isArray(v.richText)) return v.richText.map((p) => p.text).join("").trim();
    if ("text" in v && typeof v.text === "string") return v.text.trim();
    if (v instanceof Date) return v.toISOString().slice(0, 10);
  }
  return String(v).replace(/ /g, " ").trim();
}

interface Columns {
  customer: number;
  from: number;
  to: number;
  year: number | null;
}

/** Which column is which, if this row is a header: a customer column and a "from" and a "to". */
function readHeader(cells: string[]): Columns | null {
  const keys = cells.map(normaliseHeader);
  const customer = keys.findIndex((k) => k === "customer" || k === "customer_name" || k.startsWith("customer_"));
  const from = keys.findIndex((k) => k === "from" || k.endsWith("_from"));
  const to = keys.findIndex((k) => k === "to" || k.endsWith("_to"));
  if (customer < 0 || from < 0 || to < 0) return null;
  const year = keys.findIndex((k) => k === "fy" || k === "year" || k === "financial_year" || k === "fy_year");
  return { customer, from, to, year: year < 0 ? null : year };
}

export async function parseTdsCorrections(input: Buffer | ArrayBuffer): Promise<TdsCorrectionParseResult> {
  const workbook = await readWorkbook(input);
  const rows: TdsCorrectionRow[] = [];
  const warnings: string[] = [];
  let firstHeader: { sheetName: string; headerRow: number; columns: string[] } | null = null;

  workbook.eachSheet((sheet) => {
    let columns: Columns | null = null;
    let instruction: string | null = null;

    for (let r = 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        cells[col - 1] = text(cell);
      });
      for (let i = 0; i < cells.length; i++) cells[i] = cells[i] ?? "";
      const filled = cells.filter(Boolean);
      if (filled.length === 0) continue;

      // A header row opens a table (and a later one opens the next).
      const header = readHeader(cells);
      if (header) {
        columns = header;
        firstHeader ??= { sheetName: sheet.name, headerRow: r, columns: cells.filter(Boolean) };
        continue;
      }

      // A line of text on its own is an instruction: it closes the table above it.
      if (filled.length === 1) {
        instruction = filled[0];
        columns = null;
        continue;
      }

      if (!columns) continue;
      const customer = cells[columns.customer] ?? "";
      const from = cells[columns.from] ?? "";
      const to = cells[columns.to] ?? "";
      const yearText = columns.year === null ? "" : (cells[columns.year] ?? "");
      if (!customer && !from && !to) continue;
      if (!customer || !from || !to) {
        warnings.push(`Row ${r} was skipped: it needs a customer, the vertical it moves from and the vertical it moves to.`);
        continue;
      }
      let fy: string | null = null;
      if (yearText) {
        fy = normaliseFy(yearText);
        if (!fy) {
          warnings.push(`Row ${r} (${customer}) was skipped: the year "${yearText}" is not a financial year such as FY24-25.`);
          continue;
        }
      }
      rows.push({ customer, from, to, fy, instruction, sheetRow: r });
    }
  });

  if (!firstHeader) {
    throw new Error(
      "Could not find the corrections table. Expected a header row with a Customer column and " +
        "columns for the vertical it is moved from and to (for example Customer, Tfd from, Tfd to).",
    );
  }
  if (rows.length === 0) {
    throw new Error("The table was found but it has no rows with a customer and both verticals.");
  }
  return { rows, warnings, detected: firstHeader };
}

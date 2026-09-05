import type ExcelJS from "exceljs";
import { readWorkbook, toDateISO, toNumber, type Cell } from "./workbook";

/**
 * Form 26AS / Form 168 (Annual Tax Statement) parser - Part I only.
 *
 * The layout is not a table. It is a printed statement exported to Excel, with
 * every value living in a merged range, page headers and footers repeating
 * every ~40 rows, and a two-level structure:
 *
 *   deductor row      1 | RAM NATH AND CO PVT LTD | TAN | PAN | total paid | total TDS
 *     column header   S.No. | Section | Transaction Date | Status of Booking | ...
 *     txn row         1.1 | 1027 | 22-Jun-2026 | Final | 06-Aug-2026 | - | paid | TDS
 *     txn row         1.2 | ...
 *   deductor row      2 | CYBELE INDUSTRIES LIMITED | ...
 *
 * Deductor rows are numbered 1, 2, 3; their transactions 1.1, 1.2. That
 * numbering is the only reliable signal of which kind of row you are on, so it
 * drives the parse rather than column positions, which shift between the two
 * header styles and between statements.
 *
 * Only Part I is read. Parts II onwards (TCS, refunds, SFT, demand) are a
 * different shape and are not part of a TDS receivable reconciliation.
 */

export interface ParsedTdsTransaction {
  deductorName: string;
  tan: string | null;
  deductorPan: string | null;
  section: string | null;
  transactionDate: string | null;
  bookingStatus: string | null;
  bookingDate: string | null;
  amountCredited: number;
  taxDeducted: number;
  tdsDeposited: number;
}

export interface Tds26asParseResult {
  rows: ParsedTdsTransaction[];
  /** deductor name -> its stated totals, used to verify the parse */
  deductorTotals: Map<string, { amountCredited: number; taxDeducted: number }>;
  pan: string | null;
  assesseeName: string | null;
  taxYear: string | null;
  /** "Data updated till 11-Aug-2026" */
  updatedTill: string | null;
  /** the statement's own TDS summary figure, if present */
  statementTotalTds: number | null;
  totalTaxDeducted: number;
  warnings: string[];
  detected: { sheetName: string; partIRow: number; deductors: number };
}

/** Cell text, unwrapping ExcelJS formula and rich-text shapes. */
function cellText(cell: ExcelJS.Cell | undefined): string {
  if (!cell) return "";
  let v: unknown = cell.value;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("result" in o && o.result !== undefined) v = o.result;
    else if ("text" in o && typeof o.text === "string") v = o.text;
    else if (Array.isArray(o.richText)) v = (o.richText as { text: string }[]).map((t) => t.text).join("");
    else if (v instanceof Date) v = v;
  }
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return v === null || v === undefined ? "" : String(v).trim();
}

/** Every distinct value on a row, in column order, with merge repeats collapsed. */
function rowValues(sheet: ExcelJS.Worksheet, r: number): { col: number; text: string }[] {
  const out: { col: number; text: string }[] = [];
  let previous = "";
  sheet.getRow(r).eachCell({ includeEmpty: false }, (cell, col) => {
    const text = cellText(cell);
    if (!text || text === previous) return;
    out.push({ col, text });
    previous = text;
  });
  return out;
}

/** A TAN is four letters, five digits, one letter. */
const TAN_RE = /^[A-Z]{4}\d{5}[A-Z]$/;
const DEDUCTOR_SNO = /^\d+$/;
const TXN_SNO = /^\d+\.\d+$/;

/** Values that mean "nothing here" in this statement. */
function orNull(text: string): string | null {
  const t = text.trim();
  return t === "" || t === "-" ? null : t;
}

export async function parseForm26AS(input: Buffer | ArrayBuffer): Promise<Tds26asParseResult> {
  const workbook = await readWorkbook(input);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("That workbook has no sheets.");

  const warnings: string[] = [];
  let pan: string | null = null;
  let assesseeName: string | null = null;
  let taxYear: string | null = null;
  let updatedTill: string | null = null;
  let statementTotalTds: number | null = null;
  let partIRow = 0;

  // ---- header block: PAN, name, year, and the statement's own TDS total ----
  for (let r = 1; r <= Math.min(sheet.rowCount, 60); r++) {
    const values = rowValues(sheet, r);
    const labels = values.map((v) => v.text);

    for (const label of labels) {
      const m = label.match(/Data updated till\s+(.+)$/i);
      if (m) updatedTill = toDateISO(m[1].trim() as Cell) ?? m[1].trim();
    }

    const next = rowValues(sheet, r + 1).map((v) => v.text);
    if (labels.some((l) => /^Permanent Account Number/i.test(l))) {
      pan = next.find((v) => /^[A-Z]{5}\d{4}[A-Z]$/.test(v)) ?? pan;
      const year = next.find((v) => /^\d{4}-\d{2}$/.test(v));
      if (year) taxYear = year;
    }
    if (labels.some((l) => /^Name of Assessee/i.test(l))) {
      assesseeName = next.find((v) => v.length > 2) ?? assesseeName;
    }
    // "TDS | TCS | Total TDS/TCS Demand Outstanding" with the figures beneath.
    if (labels.some((l) => l === "TDS") && labels.some((l) => l === "TCS")) {
      const tdsCol = values.find((v) => v.text === "TDS")?.col ?? 0;
      const figure = rowValues(sheet, r + 1).find((v) => v.col >= tdsCol);
      if (figure) statementTotalTds = toNumber(figure.text as Cell);
    }
    if (labels.some((l) => /PART\s*I\b.*Tax Deducted at Source/i.test(l))) partIRow = r;
  }

  if (partIRow === 0) {
    // Fall back to scanning the whole sheet before giving up.
    for (let r = 1; r <= sheet.rowCount; r++) {
      if (rowValues(sheet, r).some((v) => /PART\s*I\b.*Tax Deducted at Source/i.test(v.text))) {
        partIRow = r;
        break;
      }
    }
  }
  if (partIRow === 0) {
    throw new Error(
      "Could not find \"PART I - Details of Tax Deducted at Source\" in that file. " +
        "Download Form 26AS / Form 168 from the income tax portal as XLSX.",
    );
  }

  // ---- Part I: deductor blocks and their transactions ----
  const rows: ParsedTdsTransaction[] = [];
  const deductorTotals = new Map<string, { amountCredited: number; taxDeducted: number }>();

  let current: { name: string; tan: string | null; pan: string | null } | null = null;
  let deductors = 0;

  for (let r = partIRow + 1; r <= sheet.rowCount; r++) {
    const values = rowValues(sheet, r);
    if (values.length === 0) continue;

    // Part I ends where the next part begins.
    if (values.some((v) => /^PART\s+(II|III|IV|V|VI|VII|VIII|IX|X)\b/i.test(v.text))) break;

    const first = values[0];
    const sno = first.text;

    // A deductor line: integer serial, then a name and a TAN.
    if (DEDUCTOR_SNO.test(sno) && first.col <= 4) {
      const tanEntry = values.find((v) => TAN_RE.test(v.text.toUpperCase()));
      if (!tanEntry) continue; // a page number or stray figure, not a deductor

      const nameEntry = values.find((v) => v.col > first.col && v.col < tanEntry.col);
      const name = nameEntry ? nameEntry.text : null;
      if (!name) continue;

      const after = values.filter((v) => v.col > tanEntry.col);
      const panEntry = after.find((v) => /^[A-Z]{5}\d{4}[A-Z]$/.test(v.text.toUpperCase()));
      const figures = after
        .filter((v) => /[\d]/.test(v.text) && !/^[A-Z]{5}\d{4}[A-Z]$/i.test(v.text))
        .map((v) => toNumber(v.text as Cell));

      current = { name, tan: tanEntry.text.toUpperCase(), pan: panEntry?.text.toUpperCase() ?? null };
      deductors++;
      deductorTotals.set(name, {
        amountCredited: figures[0] ?? 0,
        taxDeducted: figures[1] ?? 0,
      });
      continue;
    }

    // A transaction line beneath the current deductor.
    if (TXN_SNO.test(sno) && current) {
      const after = values.filter((v) => v.col > first.col);
      const dateEntry = after.find((v) => toDateISO(v.text as Cell) !== null);
      const section = after.find((v) => v.col < (dateEntry?.col ?? Infinity))?.text ?? null;

      const status = after.find((v) => /^(Final|Provisional|Overbooked|Unmatched|F|O|U|P)$/i.test(v.text));
      const bookingDate = after.find(
        (v) => v.col > (dateEntry?.col ?? 0) && v !== dateEntry && toDateISO(v.text as Cell) !== null,
      );

      // The money columns are the trailing numerics: paid, deducted, deposited.
      const figures = after
        .filter((v) => v.col > (bookingDate?.col ?? dateEntry?.col ?? 0))
        .filter((v) => /\d/.test(v.text) && toDateISO(v.text as Cell) === null)
        .map((v) => toNumber(v.text as Cell));

      rows.push({
        deductorName: current.name,
        tan: current.tan,
        deductorPan: current.pan,
        section: orNull(section ?? ""),
        transactionDate: dateEntry ? toDateISO(dateEntry.text as Cell) : null,
        bookingStatus: status ? status.text : null,
        bookingDate: bookingDate ? toDateISO(bookingDate.text as Cell) : null,
        amountCredited: figures[0] ?? 0,
        taxDeducted: figures[1] ?? 0,
        tdsDeposited: figures[2] ?? figures[1] ?? 0,
      });
    }
  }

  if (rows.length === 0) {
    throw new Error(
      "Part I was found but no TDS transactions could be read from it. " +
        "Check that the statement covers a year with deductions.",
    );
  }

  const totalTaxDeducted = rows.reduce((s, r) => s + r.taxDeducted, 0);

  // Every deductor states its own total. Summing the transactions beneath must
  // reproduce it, and a mismatch means rows were missed or double read.
  let mismatched = 0;
  for (const [name, stated] of deductorTotals) {
    const summed = rows
      .filter((r) => r.deductorName === name)
      .reduce((s, r) => s + r.taxDeducted, 0);
    if (Math.abs(summed - stated.taxDeducted) > 1) mismatched++;
  }
  if (mismatched > 0) {
    warnings.push(
      `${mismatched} deductor(s) do not agree with the sum of their own transaction lines. ` +
        "Treat those figures with care.",
    );
  }

  if (statementTotalTds !== null && Math.abs(statementTotalTds - totalTaxDeducted) > 1) {
    warnings.push(
      `The statement summary shows TDS of ${statementTotalTds.toFixed(2)} but the Part I ` +
        `lines total ${totalTaxDeducted.toFixed(2)}. The summary may include TCS or other parts.`,
    );
  }

  const undated = rows.filter((r) => !r.transactionDate).length;
  if (undated > 0) warnings.push(`${undated} transaction line(s) have no readable date.`);

  return {
    rows,
    deductorTotals,
    pan,
    assesseeName,
    taxYear,
    updatedTill,
    statementTotalTds,
    totalTaxDeducted,
    warnings,
    detected: { sheetName: sheet.name, partIRow, deductors },
  };
}

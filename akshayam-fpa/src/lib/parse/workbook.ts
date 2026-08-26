import ExcelJS from "exceljs";

/**
 * Generic spreadsheet reading helpers.
 *
 * Zoho exports are not clean tables: they carry two to five title rows
 * (company name, report name, date range) above the real header, blank spacer
 * rows, and a total row at the bottom. Everything here is built to locate the
 * real header row rather than assume row 1.
 */

export type Cell = string | number | Date | null;

export interface SheetTable {
  sheetName: string;
  /** Normalised header keys, in column order. */
  headers: string[];
  /** Header text exactly as it appeared, for showing the user what we found. */
  rawHeaders: string[];
  /** 1-based row number the header was found on. */
  headerRow: number;
  rows: Record<string, Cell>[];
}

/** "Transaction Date " -> "transaction_date" */
export function normaliseHeader(raw: string): string {
  return String(raw ?? "")
    .replace(/ /g, " ")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** OLE2 compound-document signature: a legacy .xls, not a zipped .xlsx. */
const OLE2_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

function isLegacyXls(view: Uint8Array): boolean {
  return OLE2_SIGNATURE.every((byte, i) => view[i] === byte);
}

/**
 * Convert a legacy .xls into .xlsx bytes.
 *
 * Some Zoho reports (Payments Received among them) still download as BIFF .xls,
 * which ExcelJS cannot read. Rather than fork the pipeline, the file is
 * converted here and everything downstream stays identical.
 */
async function convertLegacyXls(view: Uint8Array): Promise<Buffer> {
  let XLSX: typeof import("xlsx");
  try {
    XLSX = await import("xlsx");
  } catch {
    throw new Error(
      "That is a legacy .xls file and the converter is not installed. " +
        "Re-export it from Zoho Books choosing Export As > XLSX.",
    );
  }
  const source = XLSX.read(view, { type: "array", cellDates: true });
  return XLSX.write(source, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export async function readWorkbook(input: Buffer | ArrayBuffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  const view =
    input instanceof ArrayBuffer
      ? new Uint8Array(input)
      : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);

  const bytes = isLegacyXls(view) ? await convertLegacyXls(view) : Buffer.from(view);

  // ExcelJS ships its own Buffer declaration, which @types/node 24 no longer
  // structurally matches. The value below is a genuine Node Buffer - which is
  // exactly what load() reads at runtime - so the mismatch is in the typings.
  type ExcelBuffer = Parameters<typeof workbook.xlsx.load>[0];
  await workbook.xlsx.load(bytes as unknown as ExcelBuffer);

  return workbook;
}

/** Raw value of a cell, unwrapping ExcelJS formula/rich-text wrappers. */
function cellValue(cell: ExcelJS.Cell): Cell {
  const v = cell.value;
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === "number" || typeof v === "string") return v;
  if (typeof v === "object") {
    if ("result" in v && v.result !== undefined) return v.result as Cell;
    if ("richText" in v && Array.isArray(v.richText)) {
      return v.richText.map((part) => part.text).join("");
    }
    if ("text" in v && typeof v.text === "string") return v.text;
  }
  return String(v);
}

/**
 * Find the header row and read the table beneath it.
 *
 * @param mustHave groups of synonyms; a candidate row qualifies only if it
 *   contains at least one column from every group. Passing
 *   [["date"], ["debit","credit"]] means "a date column AND a debit or credit".
 */
export function findTable(
  sheet: ExcelJS.Worksheet,
  mustHave: string[][],
  searchRows = 30,
): SheetTable | null {
  const limit = Math.min(sheet.rowCount, searchRows);

  for (let r = 1; r <= limit; r++) {
    const row = sheet.getRow(r);
    const rawHeaders: string[] = [];
    const headers: string[] = [];
    // Some exports repeat a column name - the Credit Note report carries
    // date/bcy_total/amount_without_tax twice, once for the credit note and
    // once for the invoice it was applied against. Without suffixing, the
    // second silently overwrites the first and the wrong figure is read.
    const seen = new Map<string, number>();

    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const raw = cellValue(cell);
      const text = raw === null ? "" : String(raw);
      rawHeaders[colNumber - 1] = text;

      const base = normaliseHeader(text);
      if (!base) {
        headers[colNumber - 1] = "";
        return;
      }
      const count = (seen.get(base) ?? 0) + 1;
      seen.set(base, count);
      headers[colNumber - 1] = count === 1 ? base : `${base}_${count}`;
    });

    const present = new Set(headers.filter(Boolean));
    const qualifies = mustHave.every((group) => group.some((name) => present.has(name)));
    if (!qualifies) continue;

    return { sheetName: sheet.name, headers, rawHeaders, headerRow: r, rows: readRows(sheet, headers, r) };
  }

  return null;
}

function readRows(
  sheet: ExcelJS.Worksheet,
  headers: string[],
  headerRow: number,
): Record<string, Cell>[] {
  const out: Record<string, Cell>[] = [];

  for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const record: Record<string, Cell> = {};
    let populated = 0;

    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const key = headers[colNumber - 1];
      if (!key) return;
      const value = cellValue(cell);
      record[key] = value;
      if (value !== null && String(value).trim() !== "") populated++;
    });

    // Keep sparse rows: in a sectioned general ledger a single populated cell
    // is the account name, which the GL parser needs to see.
    if (populated > 0) out.push(record);
  }

  return out;
}

/* ============================================================
   Value coercion
   ============================================================ */

/**
 * Parse a number that may arrive as "1,23,456.78", "(4,500)", "Rs. 1,200"
 * or an Excel numeric. Accounting brackets mean negative.
 */
export function toNumber(value: Cell): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value instanceof Date) return 0;

  let text = String(value).trim();
  if (!text || text === "-") return 0;

  const bracketed = /^\(.*\)$/.test(text);
  text = text.replace(/[()]/g, "");
  text = text.replace(/[^0-9.\-]/g, ""); // strips commas, currency symbols, spaces
  if (!text || text === "-" || text === ".") return 0;

  const n = Number(text);
  if (!Number.isFinite(n)) return 0;
  return bracketed ? -Math.abs(n) : n;
}

export type DateOrder = "dmy" | "mdy";

/**
 * Scan a column of date-like strings and decide whether it is day-first or
 * month-first. Indian exports are day-first, but a file with only days 1-12
 * is genuinely ambiguous, so we default to dmy and say so.
 */
export function detectDateOrder(values: Cell[]): DateOrder {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const m = value.trim().match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
    if (!m) continue;
    const first = Number(m[1]);
    const second = Number(m[2]);
    if (first > 12 && second <= 12) return "dmy";
    if (second > 12 && first <= 12) return "mdy";
  }
  return "dmy";
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const pad = (n: number) => String(n).padStart(2, "0");

/** Coerce a cell to an ISO date string (YYYY-MM-DD), or null if it is not a date. */
export function toDateISO(value: Cell, order: DateOrder = "dmy"): string | null {
  if (value === null || value === undefined) return null;

  if (value instanceof Date) {
    // ExcelJS returns dates as UTC midnight; read the UTC parts so a negative
    // local offset cannot shift the date back a day.
    return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
  }

  if (typeof value === "number") {
    // Excel serial date: day 1 is 1900-01-01, with the well-known 1900 leap-year bug.
    if (value < 20 || value > 80000) return null;
    const ms = Math.round((value - 25569) * 86400 * 1000);
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }

  const text = String(value).trim();
  if (!text) return null;

  // Already ISO
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${pad(Number(iso[2]))}-${pad(Number(iso[3]))}`;

  // "05 Apr 2025" / "05-Apr-2025" / "Apr 5, 2025"
  const named = text.match(/^(\d{1,2})[\s\-/]*([A-Za-z]{3,})[\s\-/]*(\d{2,4})$/);
  if (named) {
    const month = MONTH_NAMES[named[2].slice(0, 4).toLowerCase()] ?? MONTH_NAMES[named[2].slice(0, 3).toLowerCase()];
    if (month) return `${expandYear(named[3])}-${pad(month)}-${pad(Number(named[1]))}`;
  }
  const namedFirst = text.match(/^([A-Za-z]{3,})[\s\-/]*(\d{1,2}),?[\s\-/]*(\d{2,4})$/);
  if (namedFirst) {
    const month = MONTH_NAMES[namedFirst[1].slice(0, 4).toLowerCase()] ?? MONTH_NAMES[namedFirst[1].slice(0, 3).toLowerCase()];
    if (month) return `${expandYear(namedFirst[3])}-${pad(month)}-${pad(Number(namedFirst[2]))}`;
  }

  // Numeric with separators
  const numeric = text.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (numeric) {
    const a = Number(numeric[1]);
    const b = Number(numeric[2]);
    const day = order === "dmy" ? a : b;
    const month = order === "dmy" ? b : a;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${expandYear(numeric[3])}-${pad(month)}-${pad(day)}`;
  }

  return null;
}

function expandYear(raw: string): number {
  const n = Number(raw);
  if (raw.length === 4) return n;
  // Two-digit years in accounting exports are always this century.
  return 2000 + n;
}

/**
 * True when a row is a spilled title or footer rather than data.
 *
 * Zoho writes lines like "24/08/2026    Accountant - Un-maze Team" into a
 * merged cell, which arrives as the same text repeated across every column.
 * Such a row can otherwise satisfy every "required field" check and enter the
 * data as a phantom record.
 */
export function isRepeatedRow(row: Record<string, Cell>): boolean {
  const values = Object.values(row)
    .map((v) => (v === null || v === undefined ? "" : String(v).trim()))
    .filter(Boolean);
  return values.length >= 3 && new Set(values).size === 1;
}

/** Trimmed string, or null for blanks. */
export function toText(value: Cell): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/ /g, " ").trim();
  return text === "" ? null : text;
}

/**
 * Placeholders Zoho writes into a reporting-tag column when no tag was set.
 *
 * Read literally they become a vertical called "Not mentioned" sitting next to
 * the real ones, which then has to be explained away on every vertical-wise
 * report. An untagged row is untagged; that is a null, not a business line.
 */
const UNTAGGED = new Set([
  "not mentioned", "unassigned", "untagged", "none", "n/a", "na", "not applicable", "-", "--",
]);

/** A reporting tag, or null when the cell is blank or one of Zoho's placeholders. */
export function toTag(value: Cell): string | null {
  const text = toText(value);
  if (!text) return null;
  return UNTAGGED.has(text.toLowerCase()) ? null : text;
}

/** First matching key present in the row, for synonym handling. */
export function pick(row: Record<string, Cell>, ...keys: string[]): Cell {
  for (const key of keys) {
    if (key in row && row[key] !== null && String(row[key]).trim() !== "") return row[key];
  }
  return null;
}

/** Does this table have any of these columns? */
export function hasColumn(table: SheetTable, ...keys: string[]): boolean {
  return keys.some((k) => table.headers.includes(k));
}

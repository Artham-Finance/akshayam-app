import type ExcelJS from "exceljs";
import { readWorkbook } from "./workbook";

/**
 * OSB expenses - costs paid outside the books, kept in a small hand-made sheet.
 *
 * The layout is the firm's own, not a Zoho export:
 *
 *     Born to win                 <- what the money was spent on
 *     Vertical   | September      <- a header row; month columns follow it
 *     CFC rekha  | 75000
 *     Common     | 180000
 *                | 255000        <- a total, left blank in the first column
 *
 * A month header is a month's name, with or without a year ("September",
 * "Sep-26", "September 2026") or a real date. The year is only known when the
 * header carries one; otherwise the loader places the month in the financial
 * year the ledger is currently in. Anything to the right of the month columns
 * (a "30000 x 6" working note, say) is ignored - only a column with a month
 * header is read.
 */

export interface OsbExpenseRow {
  particulars: string;
  /** the label as written, e.g. "CFC rekha" - matched to a vertical on load */
  verticalLabel: string;
  /** 1-12 */
  month: number;
  /** null when the header gave only the month's name */
  year: number | null;
  amount: number;
}

export interface OsbExpenseParseResult {
  rows: OsbExpenseRow[];
  warnings: string[];
  detected: { sheetName: string; headerRow: number; particulars: string; months: string[] };
}

const MONTHS = [
  "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
];

function plain(cell: ExcelJS.Cell): string | number | Date | null {
  const v = cell.value;
  if (v === null || v === undefined) return null;
  if (v instanceof Date || typeof v === "number" || typeof v === "string") return v;
  if (typeof v === "object") {
    if ("result" in v && v.result !== undefined) return v.result as string | number | Date;
    if ("richText" in v && Array.isArray(v.richText)) return v.richText.map((p) => p.text).join("");
    if ("text" in v && typeof v.text === "string") return v.text;
  }
  return String(v);
}

const text = (v: string | number | Date | null): string | null => {
  if (v === null || v instanceof Date) return null;
  const t = String(v).replace(/ /g, " ").trim();
  return t === "" ? null : t;
};

function asNumber(v: string | number | Date | null): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (v === null || v instanceof Date) return 0;
  const cleaned = String(v).replace(/[^0-9.\-]/g, "");
  const n = Number(cleaned);
  return cleaned && Number.isFinite(n) ? n : 0;
}

/** A header cell read as a month, or null when it is not one. */
function asMonth(v: string | number | Date | null): { month: number; year: number | null } | null {
  if (v instanceof Date) return { month: v.getUTCMonth() + 1, year: v.getUTCFullYear() };
  const t = text(v);
  if (!t) return null;
  const name = t.toLowerCase().match(/^([a-z]{3})[a-z]*\b/);
  if (!name) return null;
  const month = MONTHS.indexOf(name[1]) + 1;
  if (month === 0) return null;
  const yearMatch = t.match(/(\d{4}|\d{2})\s*$/);
  let year: number | null = null;
  if (yearMatch) {
    const n = Number(yearMatch[1]);
    year = yearMatch[1].length === 2 ? 2000 + n : n;
  }
  return { month, year };
}

export async function parseOsbExpenses(input: Buffer | ArrayBuffer): Promise<OsbExpenseParseResult> {
  const workbook = await readWorkbook(input);

  for (const sheet of workbook.worksheets) {
    // The header row is the first one whose leading cell says "Vertical" and
    // that has at least one month beside it.
    for (let r = 1; r <= Math.min(sheet.rowCount, 30); r++) {
      const row = sheet.getRow(r);
      const labelCol = (() => {
        for (let c = 1; c <= Math.min(row.cellCount, 6); c++) {
          if (/^vertical/i.test(text(plain(row.getCell(c))) ?? "")) return c;
        }
        return 0;
      })();
      if (!labelCol) continue;
      const found: { col: number; month: number; year: number | null; label: string }[] = [];
      for (let c = labelCol + 1; c <= row.cellCount; c++) {
        const m = asMonth(plain(row.getCell(c)));
        if (m) found.push({ col: c, ...m, label: text(plain(row.getCell(c))) ?? "" });
      }
      if (found.length > 0) return finish(sheet, r, labelCol, found);
    }
  }

  throw new Error(
    "Could not find the OSB expenses table. Expected a title (what the money was spent on), then a " +
      "header row with \"Vertical\" and a month's name, then one row per vertical with an amount.",
  );
}

function finish(
  sheet: ExcelJS.Worksheet,
  headerRow: number,
  labelCol: number,
  monthCols: { col: number; month: number; year: number | null; label: string }[],
): OsbExpenseParseResult {
  // The title is the first text above the header - "Born to win".
  let particulars: string | null = null;
  for (let r = 1; r < headerRow && !particulars; r++) {
    const row = sheet.getRow(r);
    for (let c = 1; c <= row.cellCount && !particulars; c++) {
      particulars = text(plain(row.getCell(c)));
    }
  }
  if (!particulars) {
    throw new Error(
      "The sheet has no title above the table. Put what the money was spent on (for example " +
        "\"Born to win\") on the line above the header, so the entry can be told apart from others.",
    );
  }

  const rows: OsbExpenseRow[] = [];
  const warnings: string[] = [];
  for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const label = text(plain(row.getCell(labelCol)));
    // The total sits on a row with no label; "Total" written out is the same row.
    if (!label || /^(grand\s+)?total/i.test(label)) continue;
    let any = false;
    for (const m of monthCols) {
      const amount = asNumber(plain(row.getCell(m.col)));
      if (!amount) continue;
      any = true;
      rows.push({
        particulars,
        verticalLabel: label,
        month: m.month,
        year: m.year,
        amount,
      });
    }
    if (!any) warnings.push(`"${label}" has no amount under any month and was skipped.`);
  }

  if (rows.length === 0) {
    throw new Error("The table was found but no vertical carried an amount. Check this is the right file.");
  }

  return {
    rows,
    warnings,
    detected: {
      sheetName: sheet.name,
      headerRow,
      particulars,
      months: monthCols.map((m) => m.label),
    },
  };
}

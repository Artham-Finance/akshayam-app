import type ExcelJS from "exceljs";
import {
  findTable,
  isRepeatedRow,
  pick,
  readWorkbook,
  toDateISO,
  toNumber,
  toTag,
  toText,
  type Cell,
  type SheetTable,
} from "./workbook";

/**
 * Recurring retainership invoices.
 *
 * The two companies keep this list in two different shapes and both are in
 * use, so both are read rather than asking anyone to reformat a working file:
 *
 *   long    one row per customer per month, with the reporting tag on the row
 *           (month | customer_name | customer_id | amount | Vertical)
 *   matrix  one row per customer, one column per month, a total column on the
 *           right and a total row at the foot
 *           (S.No | Customer Name | Apr-26 | May-26 | ... | Total)
 *
 * Both reduce to the same thing: an amount per customer per month.
 */

export interface ParsedRetainerRow {
  month: string;
  customerName: string;
  customerRef: string | null;
  vertical: string | null;
  amountBase: number;
}

export interface RetainerParseResult {
  rows: ParsedRetainerRow[];
  verticals: Set<string>;
  periodStart: string | null;
  periodEnd: string | null;
  warnings: string[];
  detected: { sheetName: string; headerRow: number; layout: "long" | "matrix"; columns: string[] };
}

const CUSTOMER_KEYS = ["customer_name", "customer", "client_name", "client", "name"];
const MONTH_KEYS = ["month", "period", "invoice_month"];
const AMOUNT_KEYS = ["amount", "amount_base", "bcy_amount", "value", "retainer_amount"];
const REF_KEYS = ["customer_id", "customer_ref", "client_id"];
const VERTICAL_KEYS = ["vertical", "reporting_tag", "segment", "practice"];

const MONTH_ABBR = [
  "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
];

/** "Apr-26" / "apr_26" / "Apr 2026" -> "2026-04-01", or null if it is not a month. */
function monthColumn(header: string): string | null {
  const m = header.toLowerCase().match(/^([a-z]{3})[a-z]*[_\s-]*(\d{2,4})$/);
  if (!m) return null;
  const index = MONTH_ABBR.indexOf(m[1]);
  if (index < 0) return null;
  const year = m[2].length === 4 ? Number(m[2]) : 2000 + Number(m[2]);
  return `${year}-${String(index + 1).padStart(2, "0")}-01`;
}

/** A total row or column is a rollup of what is already there and must not be read twice. */
const TOTAL = /^(total|grand total|sub\s*total)\b/i;

/** Snap any date in a month to that month's first day. */
function firstOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

export async function parseRetainers(input: Buffer | ArrayBuffer): Promise<RetainerParseResult> {
  const workbook = await readWorkbook(input);

  // Held as one object so the layout and the table it describes cannot drift.
  let found: { table: SheetTable; layout: "long" | "matrix" } | null = null;

  workbook.eachSheet((sheet: ExcelJS.Worksheet) => {
    if (found) return;
    const long = findTable(sheet, [CUSTOMER_KEYS, MONTH_KEYS, AMOUNT_KEYS]);
    if (long) {
      found = { table: long, layout: "long" };
      return;
    }
    // A matrix has the customer column and at least one month-named column.
    const matrix = findTable(sheet, [CUSTOMER_KEYS]);
    if (matrix && matrix.headers.some((h) => h && monthColumn(h))) {
      found = { table: matrix, layout: "matrix" };
    }
  });

  if (!found) {
    throw new Error(
      "Could not find a retainer table. Expected either a customer / month / amount " +
        "listing, or customers down the side with a column per month.",
    );
  }

  const { table, layout } = found as { table: SheetTable; layout: "long" | "matrix" };
  const rows: ParsedRetainerRow[] = [];
  const verticals = new Set<string>();
  const warnings: string[] = [];
  let skipped = 0;

  const monthColumns = table.headers
    .map((h) => ({ key: h, month: h ? monthColumn(h) : null }))
    .filter((c): c is { key: string; month: string } => c.month !== null);

  for (const row of table.rows) {
    if (isRepeatedRow(row)) continue;
    const customerName = toText(pick(row, ...CUSTOMER_KEYS));
    if (!customerName || TOTAL.test(customerName)) continue;

    const vertical = toTag(pick(row, ...VERTICAL_KEYS));
    if (vertical) verticals.add(vertical);
    const customerRef = toText(pick(row, ...REF_KEYS));

    if (layout === "matrix") {
      for (const column of monthColumns) {
        const amount = toNumber(row[column.key] as Cell);
        if (amount === 0) continue;
        rows.push({ month: column.month, customerName, customerRef, vertical, amountBase: amount });
      }
      continue;
    }

    const month = toDateISO(pick(row, ...MONTH_KEYS));
    const amount = toNumber(pick(row, ...AMOUNT_KEYS));
    if (!month) {
      skipped++;
      continue;
    }
    if (amount === 0) continue;
    rows.push({
      month: firstOfMonth(month),
      customerName,
      customerRef,
      vertical,
      amountBase: amount,
    });
  }

  if (rows.length === 0) throw new Error("No retainer rows could be read from that file.");
  if (skipped > 0) warnings.push(`${skipped} row(s) had no month and were skipped.`);

  /**
   * One customer can appear twice in a month - the Akshayam list notes several
   * months where a customer was billed on two or three retainer invoices. They
   * are the same month's retainer and are added, not overwritten.
   */
  const merged = new Map<string, ParsedRetainerRow>();
  for (const row of rows) {
    const key = `${row.month}|${row.customerName.toLowerCase()}`;
    const existing = merged.get(key);
    if (existing) existing.amountBase += row.amountBase;
    else merged.set(key, { ...row });
  }

  const all = [...merged.values()];
  const months = all.map((r) => r.month).sort();

  return {
    rows: all,
    verticals,
    periodStart: months[0] ?? null,
    periodEnd: months[months.length - 1] ?? null,
    warnings,
    detected: {
      sheetName: table.sheetName,
      headerRow: table.headerRow,
      layout,
      columns: table.rawHeaders.filter(Boolean),
    },
  };
}

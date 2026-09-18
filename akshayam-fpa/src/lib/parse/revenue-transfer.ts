import {
  detectDateOrder,
  findTable,
  isRepeatedRow,
  pick,
  readWorkbook,
  toDateISO,
  toNumber,
  toText,
  type SheetTable,
} from "./workbook";

/**
 * Revenue Akshayam has passed on to RBJV - a standalone upload of its own
 * rather than a sheet buried inside the weekly Invoice Details workbook
 * (055_revenue_transfer_to_rbjv.sql's approach, which needed that sheet
 * re-added to every export and stopped working once it wasn't).
 *
 * These are real Akshayam invoices, raised through GIFT, where a portion of
 * the value is really RBJV's own team's work. The client relationship and
 * the ledger posting are Akshayam's, so this carries no GL entry of its own
 * to read - it is a hand-maintained list, replaced wholesale on every
 * upload, the same convention the OSB and old revenue-transfer sheets used.
 */

const DUE_DATE_KEYS = ["due_date", "date"];
const CUSTOMER_KEYS = ["customer_name", "customer"];
const INVOICE_NO_KEYS = ["invoice_number", "invoice_no", "invoice"];
const SALESPERSON_KEYS = ["salesperson_name", "salesperson", "sales_person"];
const STATUS_KEYS = ["status", "invoice_status"];
const AMOUNT_KEYS = ["amount_without_tax", "sub_total", "amount", "total"];

export interface RevenueTransferRow {
  invoiceNumber: string;
  invoiceDate: string;
  customerName: string;
  salesperson: string | null;
  amount: number;
  status: string | null;
}

export interface RevenueTransferParseResult {
  rows: RevenueTransferRow[];
  periodStart: string | null;
  periodEnd: string | null;
  warnings: string[];
  detected: { sheetName: string; headerRow: number; columns: string[] };
}

export async function parseRevenueTransfer(
  input: Buffer | ArrayBuffer,
): Promise<RevenueTransferParseResult> {
  const workbook = await readWorkbook(input);

  let table: SheetTable | null = null;
  workbook.eachSheet((sheet) => {
    if (table) return;
    const found = findTable(sheet, [DUE_DATE_KEYS, CUSTOMER_KEYS, INVOICE_NO_KEYS]);
    if (found) table = found;
  });

  if (!table) {
    throw new Error(
      "Could not find the revenue-transfer table. Expected columns for due date, customer " +
        "name and invoice number, the same shape as the file exported from Zoho.",
    );
  }
  // TypeScript cannot see through eachSheet's callback assignment.
  const found: SheetTable = table;

  const dateOrder = detectDateOrder(found.rows.map((r) => pick(r, ...DUE_DATE_KEYS)));
  const rows: RevenueTransferRow[] = [];
  const warnings: string[] = [];
  let skipped = 0;

  for (const row of found.rows) {
    if (isRepeatedRow(row)) continue;
    const invoiceDate = toDateISO(pick(row, ...DUE_DATE_KEYS), dateOrder);
    const customerName = toText(pick(row, ...CUSTOMER_KEYS));
    const invoiceNumber = toText(pick(row, ...INVOICE_NO_KEYS));
    const amount = toNumber(pick(row, ...AMOUNT_KEYS));

    if (!invoiceDate || !customerName || !invoiceNumber || !amount) {
      skipped++;
      continue;
    }

    rows.push({
      invoiceNumber,
      invoiceDate,
      customerName,
      salesperson: toText(pick(row, ...SALESPERSON_KEYS)),
      amount,
      status: toText(pick(row, ...STATUS_KEYS)),
    });
  }

  if (rows.length === 0) {
    throw new Error(
      "The table was found but no row carried a due date, customer, invoice number and amount " +
        "together. Check this is the right file.",
    );
  }
  if (skipped > 0) {
    warnings.push(
      `${skipped} row(s) were missing a due date, customer, invoice number or amount and were skipped.`,
    );
  }

  const dates = rows.map((r) => r.invoiceDate).sort();
  return {
    rows,
    periodStart: dates[0] ?? null,
    periodEnd: dates[dates.length - 1] ?? null,
    warnings,
    detected: {
      sheetName: found.sheetName,
      headerRow: found.headerRow,
      columns: found.rawHeaders.filter(Boolean),
    },
  };
}

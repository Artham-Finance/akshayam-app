import type ExcelJS from "exceljs";
import {
  detectDateOrder,
  findTable,
  pick,
  readWorkbook,
  toDateISO,
  toNumber,
  toTag,
  toText,
  isRepeatedRow,
  type SheetTable,
} from "./workbook";

/**
 * Parsers for the three Zoho sales-side exports: invoice details (revenue),
 * customer payments (collections) and AR aging details (receivables).
 *
 * Currency note, learned the hard way on these exports:
 *   In Zoho's Indian-base exports the amount columns are already converted to
 *   the base currency (INR) even on USD invoices - the exchange_rate column is
 *   there to get *back* to the foreign currency, not to convert to INR.
 *   So: INR value = amount as-is;  USD value = amount / exchange_rate.
 *   Multiplying by exchange_rate is the classic mistake and inflates USD
 *   invoices by roughly 80x.
 */

const CUSTOMER_KEYS = ["customer_name", "customer", "contact_name", "client_name", "account_name"];
const INVOICE_NO_KEYS = [
  "invoice_number", "invoice", "invoice_no", "invoice_id", "bill_number",
  "transaction", "transaction_number", // "Transaction#" in the AR aging report
];
const CURRENCY_KEYS = ["currency_code", "currency"];
const RATE_KEYS = ["exchange_rate", "exchangerate", "rate"];
const SALESPERSON_KEYS = ["salesperson_name", "salesperson", "sales_person", "owner"];
const VERTICAL_KEYS = [
  "reporting_tag", "reporting_tags", "vertical", "segment", "division",
  "department", "cost_center", "cost_centre", "practice", "service_line", "branch",
];

function verticalOf(row: Record<string, unknown>): string | null {
  for (const key of VERTICAL_KEYS) {
    const value = row[key as keyof typeof row];
    const tag = toTag(value as never);
    if (tag) return tag;
  }
  return null;
}

/**
 * Zoho salesperson names embed the vertical:
 *   "Rekha - Corporate Formation & Secretarial Compliances (CFC)"
 *   "Vijay  - Disputes, Litigation & Resolution (DLR)"   (note the double space)
 *
 * The text after the separator is exactly the reporting tag used on the ledger,
 * so it resolves through the same vertical aliases and the invoice and AR
 * reports line up with the P&L without any extra mapping. A salesperson with no
 * separator - "Others" - yields nothing rather than a bad guess.
 */
export function verticalFromSalesperson(salesperson: string | null): string | null {
  if (!salesperson) return null;
  const parts = salesperson.split(/\s+-\s+/);
  if (parts.length < 2) return null;
  const tail = parts.slice(1).join(" - ").trim();
  return tail || null;
}

async function locate(
  input: Buffer | ArrayBuffer,
  mustHave: string[][],
  friendlyName: string,
  hint: string,
): Promise<SheetTable> {
  const workbook = await readWorkbook(input);
  let table: SheetTable | null = null;
  workbook.eachSheet((sheet: ExcelJS.Worksheet) => {
    if (table) return;
    const found = findTable(sheet, mustHave);
    if (found) table = found;
  });
  if (!table) throw new Error(`Could not find a ${friendlyName} table. ${hint}`);
  return table;
}

/* ============================================================
   Invoice details -> revenue
   ============================================================ */

export interface ParsedInvoiceRow {
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string | null;
  customerName: string;
  vertical: string | null;
  salesperson: string | null;
  itemName: string | null;
  currency: string;
  exchangeRate: number;
  amountBase: number;
  totalBase: number;
  status: string | null;
}

export interface InvoiceParseResult {
  rows: ParsedInvoiceRow[];
  verticals: Set<string>;
  periodStart: string | null;
  periodEnd: string | null;
  warnings: string[];
  detected: { sheetName: string; headerRow: number; columns: string[] };
}

export async function parseInvoices(input: Buffer | ArrayBuffer): Promise<InvoiceParseResult> {
  const table = await locate(
    input,
    [["invoice_date", "date"], CUSTOMER_KEYS, INVOICE_NO_KEYS],
    "invoice details",
    "Export from Zoho Books via Reports > Sales > Invoice Details.",
  );

  const dateOrder = detectDateOrder(table.rows.map((r) => pick(r, "invoice_date", "date")));
  const rows: ParsedInvoiceRow[] = [];
  const verticals = new Set<string>();
  const warnings: string[] = [];
  let skipped = 0;

  for (const row of table.rows) {
    if (isRepeatedRow(row)) continue; // spilled title/footer line
    const invoiceDate = toDateISO(pick(row, "invoice_date", "date"), dateOrder);
    const customerName = toText(pick(row, ...CUSTOMER_KEYS));
    const invoiceNumber = toText(pick(row, ...INVOICE_NO_KEYS));

    if (!invoiceDate || !customerName || !invoiceNumber) {
      skipped++;
      continue;
    }

    const exchangeRate = toNumber(pick(row, ...RATE_KEYS)) || 1;
    // Already in INR - see the currency note at the top of this file.
    const amountBase = toNumber(
      pick(row, "amount_without_tax", "sub_total", "amount_excluding_tax", "taxable_amount", "amount"),
    );
    const totalBase = toNumber(pick(row, "total", "invoice_amount", "grand_total")) || amountBase;

    const salesperson = toText(pick(row, ...SALESPERSON_KEYS));
    const vertical = verticalOf(row) ?? verticalFromSalesperson(salesperson);
    if (vertical) verticals.add(vertical);

    rows.push({
      invoiceNumber,
      invoiceDate,
      dueDate: toDateISO(pick(row, "due_date", "duedate"), dateOrder),
      customerName,
      vertical,
      salesperson,
      itemName: toText(pick(row, "item_name", "item", "item_description", "description")),
      currency: toText(pick(row, ...CURRENCY_KEYS)) ?? "INR",
      exchangeRate,
      amountBase,
      totalBase,
      status: toText(pick(row, "invoice_status", "status")),
    });
  }

  if (rows.length === 0) throw new Error("No invoice rows could be read from that file.");
  if (skipped > 0) warnings.push(`${skipped} row(s) were missing a date, customer or invoice number and were skipped.`);
  if (verticals.size === 0) {
    warnings.push("No reporting tag column found, so revenue cannot be split by vertical from this file.");
  }

  const dates = rows.map((r) => r.invoiceDate).sort();
  return {
    rows,
    verticals,
    periodStart: dates[0] ?? null,
    periodEnd: dates[dates.length - 1] ?? null,
    warnings,
    detected: { sheetName: table.sheetName, headerRow: table.headerRow, columns: table.rawHeaders.filter(Boolean) },
  };
}

/* ============================================================
   Customer payments -> collections
   ============================================================ */

export interface ParsedPaymentRow {
  paymentNumber: string | null;
  paymentDate: string;
  customerName: string;
  invoiceNumber: string | null;
  vertical: string | null;
  currency: string;
  amountBase: number;
  /** the receipt in the currency it arrived in, null on an INR receipt */
  amountForeign: number | null;
  /** received but not applied to any invoice: an advance or an overpayment */
  unallocatedBase: number;
  mode: string | null;
}

export interface PaymentParseResult {
  rows: ParsedPaymentRow[];
  verticals: Set<string>;
  periodStart: string | null;
  periodEnd: string | null;
  warnings: string[];
  detected: { sheetName: string; headerRow: number; columns: string[] };
}

export async function parsePayments(input: Buffer | ArrayBuffer): Promise<PaymentParseResult> {
  /**
   * A date and a customer name are not enough to know this is a receipt.
   *
   * An AR Aging export has both, so it parsed cleanly here and loaded a
   * hundred invoices as payments - and because a payments upload replaces
   * every receipt inside the range it covers, the genuine receipts underneath
   * were deleted. The tile now insists on a column only a payments export
   * carries, so the wrong file is refused instead of quietly believed.
   */
  const table = await locate(
    input,
    [
      ["date", "payment_date"],
      CUSTOMER_KEYS,
      ["payment_number", "payment_id", "receipt_number", "payment_mode", "mode", "payment_method"],
    ],
    "customer payments",
    "Export from Zoho Books via Reports > Sales > Customer Payments. " +
      "A file with no payment number or mode is not a receipts export - an AR Aging " +
      "export carries a date and a customer name too, and loading one here would " +
      "book invoices as collections.",
  );

  const dateOrder = detectDateOrder(table.rows.map((r) => pick(r, "date", "payment_date")));
  const rows: ParsedPaymentRow[] = [];
  const verticals = new Set<string>();
  const warnings: string[] = [];
  let skipped = 0;

  for (const row of table.rows) {
    if (isRepeatedRow(row)) continue;
    const paymentDate = toDateISO(pick(row, "date", "payment_date"), dateOrder);
    const customerName = toText(pick(row, ...CUSTOMER_KEYS));
    if (!paymentDate || !customerName) {
      skipped++;
      continue;
    }

    // bcy_amount is the base-currency (INR) figure; prefer it when present.
    const amountBase = toNumber(pick(row, "bcy_amount", "amount_bcy", "amount", "payment_amount"));

    // Zoho names the foreign column after the currency - "amount - USD" - so
    // the normalised key carries the code. The generic "amount" is only the
    // foreign figure when a separate bcy column exists to be the INR one;
    // without that it IS the INR figure and must not be read twice.
    const currency = toText(pick(row, ...CURRENCY_KEYS)) ?? "INR";
    const hasSeparateBase = pick(row, "bcy_amount", "amount_bcy") !== null;
    const foreign =
      currency.toUpperCase() === "INR"
        ? 0
        : toNumber(
            pick(
              row,
              // "amount - USD", "amount (USD)" and "USD amount" all normalise
              // to one of these two, and the code is whatever the row says it
              // is rather than a hard-coded USD.
              `amount_${currency.toLowerCase()}`,
              `${currency.toLowerCase()}_amount`,
              "fcy_amount",
              "amount_fcy",
              "foreign_amount",
              "amount_foreign",
              ...(hasSeparateBase ? ["amount"] : []),
            ),
          );
    // Same rule for the unapplied portion: the bcy column, then the raw one.
    const unallocatedBase = toNumber(
      pick(row, "bcy_unused_amount", "unused_amount_bcy", "unused_amount", "unapplied_amount"),
    );

    const vertical = verticalOf(row);
    if (vertical) verticals.add(vertical);

    rows.push({
      paymentNumber: toText(pick(row, "payment_number", "payment_id", "receipt_number")),
      paymentDate,
      customerName,
      invoiceNumber: toText(pick(row, ...INVOICE_NO_KEYS)),
      vertical,
      currency,
      amountBase,
      amountForeign: foreign > 0 ? foreign : null,
      unallocatedBase,
      mode: toText(pick(row, "payment_mode", "mode", "payment_method")),
    });
  }

  if (rows.length === 0) throw new Error("No payment rows could be read from that file.");
  if (skipped > 0) warnings.push(`${skipped} row(s) were missing a date or customer and were skipped.`);

  const dates = rows.map((r) => r.paymentDate).sort();
  return {
    rows,
    verticals,
    periodStart: dates[0] ?? null,
    periodEnd: dates[dates.length - 1] ?? null,
    warnings,
    detected: { sheetName: table.sheetName, headerRow: table.headerRow, columns: table.rawHeaders.filter(Boolean) },
  };
}

/* ============================================================
   AR aging details -> receivables
   ============================================================ */

export interface ParsedArRow {
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  customerName: string;
  vertical: string | null;
  salesperson: string | null;
  currency: string;
  exchangeRate: number;
  invoiceAmount: number;
  balanceBase: number;
  unusedCredit: number;
}

export interface ArParseResult {
  rows: ParsedArRow[];
  verticals: Set<string>;
  asOf: string | null;
  totalOutstanding: number;
  warnings: string[];
  detected: { sheetName: string; headerRow: number; columns: string[] };
}

export async function parseArAging(
  input: Buffer | ArrayBuffer,
  asOfOverride?: string | null,
): Promise<ArParseResult> {
  const table = await locate(
    input,
    [CUSTOMER_KEYS, ["balance", "balance_due", "outstanding", "amount_due"]],
    "AR aging details",
    "Export from Zoho Books via Reports > Receivables > AR Aging Details.",
  );

  const dateOrder = detectDateOrder(table.rows.map((r) => pick(r, "invoice_date", "date")));
  const rows: ParsedArRow[] = [];
  const verticals = new Set<string>();
  const warnings: string[] = [];

  // Unused credit repeats on every invoice row of a customer in Zoho's export,
  // so it is counted once per customer, not once per row.
  const creditSeen = new Set<string>();

  for (const row of table.rows) {
    if (isRepeatedRow(row)) continue;
    const customerName = toText(pick(row, ...CUSTOMER_KEYS));
    if (!customerName) continue;

    const balanceBase = toNumber(pick(row, "balance", "balance_due", "outstanding", "amount_due"));
    const invoiceAmount = toNumber(pick(row, "amount", "invoice_amount", "total")) || balanceBase;
    if (balanceBase === 0 && invoiceAmount === 0) continue;

    const rawCredit = toNumber(pick(row, "unused_credits", "unused_credit", "credits_available"));
    let unusedCredit = 0;
    if (rawCredit !== 0 && !creditSeen.has(customerName)) {
      creditSeen.add(customerName);
      unusedCredit = rawCredit;
    }

    const salesperson = toText(pick(row, ...SALESPERSON_KEYS));
    const vertical = verticalOf(row) ?? verticalFromSalesperson(salesperson);
    if (vertical) verticals.add(vertical);

    rows.push({
      invoiceNumber: toText(pick(row, ...INVOICE_NO_KEYS)),
      invoiceDate: toDateISO(pick(row, "invoice_date", "date"), dateOrder),
      dueDate: toDateISO(pick(row, "due_date", "duedate", "expected_payment_date"), dateOrder),
      customerName,
      vertical,
      salesperson,
      currency: toText(pick(row, ...CURRENCY_KEYS)) ?? "INR",
      exchangeRate: toNumber(pick(row, ...RATE_KEYS)) || 1,
      invoiceAmount,
      balanceBase,
      unusedCredit,
    });
  }

  if (rows.length === 0) throw new Error("No receivable rows could be read from that file.");

  const missingDueDate = rows.filter((r) => !r.dueDate).length;
  if (missingDueDate > 0) {
    warnings.push(
      `${missingDueDate} invoice(s) have no due date. Their age is measured from the invoice date instead.`,
    );
  }

  const dates = rows.map((r) => r.invoiceDate).filter(Boolean).sort() as string[];
  const asOf = asOfOverride ?? new Date().toISOString().slice(0, 10);
  const latest = dates[dates.length - 1];
  if (latest && latest > asOf) {
    warnings.push(`This file contains invoices dated after the snapshot date ${asOf}.`);
  }

  return {
    rows,
    verticals,
    asOf,
    totalOutstanding: rows.reduce((s, r) => s + r.balanceBase, 0),
    warnings,
    detected: { sheetName: table.sheetName, headerRow: table.headerRow, columns: table.rawHeaders.filter(Boolean) },
  };
}

/* ============================================================
   Credit notes -> revenue deductions
   ============================================================ */

export interface ParsedCreditNoteRow {
  creditNoteNumber: string;
  creditNoteDate: string;
  customerName: string;
  vertical: string | null;
  status: string | null;
  currency: string;
  exchangeRate: number;
  amountBase: number;
  totalBase: number;
  invoiceNumber: string | null;
  /** first row for this credit note - sum on this flag to avoid double counting */
  isPrimaryRow: boolean;
}

export interface CreditNoteParseResult {
  rows: ParsedCreditNoteRow[];
  verticals: Set<string>;
  periodStart: string | null;
  periodEnd: string | null;
  /** total of the credit notes themselves, counted once each */
  totalCredited: number;
  warnings: string[];
  detected: { sheetName: string; headerRow: number; columns: string[] };
}

/**
 * Zoho Credit Note Details.
 *
 * A credit note applied against several invoices is exported once per applied
 * invoice, repeating its own value on each row. Only the first row of each
 * credit note is marked primary, so totals are taken from those and the
 * invoice linkage is still available on every row.
 *
 * The export also repeats column names - date, bcy_total and amount_without_tax
 * appear again for the applied invoice. readWorkbook suffixes the repeats, and
 * the credit note's value is deliberately taken from the second occurrence
 * (amount_without_tax_2, column Z) rather than the plain one: Z is the figure
 * that ties to the ledger's P&L, confirmed against RBJV's own export.
 */
export async function parseCreditNotes(
  input: Buffer | ArrayBuffer,
): Promise<CreditNoteParseResult> {
  const table = await locate(
    input,
    [["creditnote_number", "credit_note_number", "creditnote_id"], CUSTOMER_KEYS],
    "credit note details",
    "Export from Zoho Books via Reports > Sales > Credit Note Details.",
  );

  const dateOrder = detectDateOrder(table.rows.map((r) => pick(r, "date", "creditnote_date")));
  const rows: ParsedCreditNoteRow[] = [];
  const verticals = new Set<string>();
  const warnings: string[] = [];
  const seen = new Set<string>();
  let skipped = 0;

  for (const row of table.rows) {
    if (isRepeatedRow(row)) continue;

    const creditNoteNumber = toText(
      pick(row, "creditnote_number", "credit_note_number", "creditnote_id"),
    );
    const creditNoteDate = toDateISO(pick(row, "date", "creditnote_date"), dateOrder);
    const customerName = toText(pick(row, ...CUSTOMER_KEYS));

    if (!creditNoteNumber || !creditNoteDate || !customerName) {
      skipped++;
      continue;
    }

    const isPrimaryRow = !seen.has(creditNoteNumber);
    seen.add(creditNoteNumber);

    const salesperson = toText(pick(row, ...SALESPERSON_KEYS));
    const vertical = verticalOf(row) ?? verticalFromSalesperson(salesperson);
    if (vertical) verticals.add(vertical);

    rows.push({
      creditNoteNumber,
      creditNoteDate,
      customerName,
      vertical,
      status: toText(pick(row, "status", "creditnote_status")),
      currency: toText(pick(row, ...CURRENCY_KEYS)) ?? "INR",
      exchangeRate: toNumber(pick(row, ...RATE_KEYS)) || 1,
      // Column Z of the Zoho export, not O - the applied invoice's own
      // amount_without_tax (readWorkbook suffixes the repeat as
      // amount_without_tax_2), which is the figure that ties to the ledger's
      // P&L rather than the credit note's own computed total.
      amountBase: toNumber(
        pick(row, "amount_without_tax_2", "amount_without_tax", "sub_total", "amount"),
      ),
      totalBase: toNumber(pick(row, "bcy_total", "total", "grand_total")),
      invoiceNumber: toText(pick(row, "invoice_number", "invoice")),
      isPrimaryRow,
    });
  }

  if (rows.length === 0) throw new Error("No credit note rows could be read from that file.");
  if (skipped > 0) {
    warnings.push(`${skipped} row(s) were missing a credit note number, date or customer.`);
  }

  const applied = rows.length - seen.size;
  if (applied > 0) {
    warnings.push(
      `${seen.size} credit note(s) across ${rows.length} rows - ${applied} row(s) are additional ` +
        "invoice applications and are not counted again in the total.",
    );
  }

  const dates = rows.map((r) => r.creditNoteDate).sort();
  return {
    rows,
    verticals,
    periodStart: dates[0] ?? null,
    periodEnd: dates[dates.length - 1] ?? null,
    totalCredited: rows.filter((r) => r.isPrimaryRow).reduce((s, r) => s + r.amountBase, 0),
    warnings,
    detected: {
      sheetName: table.sheetName,
      headerRow: table.headerRow,
      columns: table.rawHeaders.filter(Boolean),
    },
  };
}

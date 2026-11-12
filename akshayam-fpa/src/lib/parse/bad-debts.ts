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
 * The Bad Debts account's transactions, as the accountant sends them:
 *
 *   date | transaction_type | reference_number | debit | Customer Name | Vertical
 *
 * one row per invoice written off. The Vertical column is optional - Akshayam's sheet has none, and
 * its rows then belong to the company as a whole. Only rows of type "bad_debt" are taken when the
 * sheet carries a type column.
 */

const DATE_KEYS = ["date", "transaction_date", "written_off_on"];
const REFERENCE_KEYS = ["reference_number", "reference", "invoice_number", "invoice_no", "invoice"];
const AMOUNT_KEYS = ["debit", "amount", "bad_debt", "bad_debt_amount"];
const CREDIT_KEYS = ["credit"];
const CUSTOMER_KEYS = ["customer_name", "customer"];
const VERTICAL_KEYS = ["vertical", "salesperson_name", "salesperson"];
const TYPE_KEYS = ["transaction_type", "type"];

export interface BadDebtRow {
  writtenOffOn: string;
  reference: string;
  customer: string | null;
  /** the vertical as written ("Rekha-CFC"); resolved against the company's verticals on commit; null when the sheet gives none */
  vertical: string | null;
  amount: number;
  sheetRow: number;
}

export interface BadDebtParseResult {
  rows: BadDebtRow[];
  periodStart: string | null;
  periodEnd: string | null;
  warnings: string[];
  detected: { sheetName: string; headerRow: number; columns: string[]; verticalColumn: boolean };
}

export async function parseBadDebts(input: Buffer | ArrayBuffer): Promise<BadDebtParseResult> {
  const workbook = await readWorkbook(input);

  let table: SheetTable | null = null;
  workbook.eachSheet((sheet) => {
    if (table) return;
    const found = findTable(sheet, [DATE_KEYS, REFERENCE_KEYS, AMOUNT_KEYS]);
    if (found) table = found;
  });
  if (!table) {
    throw new Error(
      "Could not find the bad debts table. Expected columns for the date, the reference (invoice number) " +
        "and the amount (debit), as in the Bad Debts account's transactions.",
    );
  }
  const found: SheetTable = table;

  const dateOrder = detectDateOrder(found.rows.map((r) => pick(r, ...DATE_KEYS)));
  const hasVertical = VERTICAL_KEYS.some((k) => found.headers.includes(k));
  const hasType = TYPE_KEYS.some((k) => found.headers.includes(k));
  const rows: BadDebtRow[] = [];
  const warnings: string[] = [];
  let skipped = 0;
  let notBadDebt = 0;

  found.rows.forEach((row, i) => {
    if (isRepeatedRow(row)) return;
    const sheetRow = found.headerRow + 1 + i;
    const date = toDateISO(pick(row, ...DATE_KEYS), dateOrder);
    const reference = toText(pick(row, ...REFERENCE_KEYS)) ?? "";
    const amount = toNumber(pick(row, ...AMOUNT_KEYS)) - toNumber(pick(row, ...CREDIT_KEYS));

    if (hasType) {
      const type = (toText(pick(row, ...TYPE_KEYS)) ?? "").toLowerCase().replace(/[^a-z]/g, "");
      if (type && !type.includes("baddebt")) {
        notBadDebt++;
        return;
      }
    }
    if (!date || !reference || amount === 0) {
      if (date || reference || amount !== 0) skipped++;
      return;
    }
    const vertical = hasVertical ? toText(pick(row, ...VERTICAL_KEYS)) : null;
    rows.push({
      writtenOffOn: date,
      reference,
      customer: toText(pick(row, ...CUSTOMER_KEYS)) || null,
      vertical: vertical || null,
      amount: Math.round(amount * 100) / 100,
      sheetRow,
    });
  });

  if (skipped > 0) warnings.push(`${skipped} row(s) were skipped: each needs a date, a reference and an amount.`);
  if (notBadDebt > 0) warnings.push(`${notBadDebt} row(s) were skipped: their transaction type is not bad_debt.`);
  if (rows.length === 0) throw new Error("The bad debts table has no rows with a date, a reference and an amount.");

  const dates = rows.map((r) => r.writtenOffOn).sort();
  return {
    rows,
    periodStart: dates[0],
    periodEnd: dates[dates.length - 1],
    warnings,
    detected: {
      sheetName: found.sheetName,
      headerRow: found.headerRow,
      columns: found.rawHeaders.filter(Boolean),
      verticalColumn: hasVertical,
    },
  };
}

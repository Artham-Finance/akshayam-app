import {
  findTable,
  isRepeatedRow,
  pick,
  readWorkbook,
  toDateISO,
  toNumber,
  toText,
  type SheetTable,
} from "./workbook";
import { extractRiRefs } from "./reimbursement-bills";

/**
 * Zoho Books Account Transactions export for the reimbursable-expense
 * account - read for the one thing it has that the General Ledger export
 * does not: the RI number on a reimbursement paid straight from the bank.
 *
 * RE has three shapes, and only this one has been unreachable. A bill line
 * carries its RI number in the item-wise Bills export instead (the GL
 * collapses it away); a petty-cash reimbursement is a journal straight to
 * this account, its RI number typed into the entry's own description, which
 * *does* survive into gl_entries and is read from there directly. A bank
 * payment ("transaction_type" "expense" in this export) has neither - the
 * General Ledger's description for it is just the bank account's own name -
 * so until now it sat outside the reconciliation entirely. This report's own
 * Reference Number column turns out to carry the RI number for exactly these
 * rows, confirmed against a real posting, so only rows of this one type are
 * read; bill and journal rows in the same export are left alone; their own
 * sources already cover them and reading both would double the line.
 */

const DATE_KEYS = ["date"];
const ACCOUNT_KEYS = ["account_name"];
const TYPE_KEYS = ["transaction_type"];
const DETAILS_KEYS = ["transaction_details"];
const REFERENCE_KEYS = ["reference_number"];
const DEBIT_KEYS = ["debit"];
const CREDIT_KEYS = ["credit"];

/** Booked to the account this file exists to read - everything else is not. */
const REIMBURSEMENT_ACCOUNT = /reimb/i;

/** A bank-paid posting, as this report's own Transaction Type column names it. */
const BANK_PAID = "expense";

export interface ReimbursementExpenseRow {
  txnDate: string;
  description: string | null;
  reference: string | null;
  amount: number;
  riReferences: string[];
}

export interface ReimbursementExpenseParseResult {
  rows: ReimbursementExpenseRow[];
  periodStart: string | null;
  periodEnd: string | null;
  /** bank-paid reimbursement lines whose reference carried no RI number at all */
  untaggedCount: number;
  warnings: string[];
  detected: { sheetName: string; headerRow: number; columns: string[]; totalLines: number };
}

export async function parseReimbursementExpense(
  input: Buffer | ArrayBuffer,
): Promise<ReimbursementExpenseParseResult> {
  const workbook = await readWorkbook(input);

  let table: SheetTable | null = null;
  workbook.eachSheet((sheet) => {
    if (table) return;
    const found = findTable(sheet, [DATE_KEYS, ACCOUNT_KEYS, TYPE_KEYS]);
    if (found) table = found;
  });

  if (!table) {
    throw new Error(
      "Could not find an Account Transactions table. Expected the Zoho Books export for the " +
        "reimbursement expense account, with Date, Account Name and Transaction Type columns " +
        "(Reports → Accountant → Account Transactions).",
    );
  }
  // TypeScript cannot see through eachSheet's callback assignment.
  const found: SheetTable = table;

  const warnings: string[] = [];
  const rows: ReimbursementExpenseRow[] = [];
  let totalLines = 0;
  let untaggedCount = 0;

  for (const row of found.rows) {
    if (isRepeatedRow(row)) continue;

    const date = toDateISO(pick(row, ...DATE_KEYS));
    const account = toText(pick(row, ...ACCOUNT_KEYS));
    const txnType = toText(pick(row, ...TYPE_KEYS));
    if (date === null || !account || !txnType) continue;
    if (!REIMBURSEMENT_ACCOUNT.test(account)) continue;
    // Bill and petty-cash-journal rows are read from elsewhere; only the
    // bank-paid ones are what this file is for.
    if (txnType.toLowerCase() !== BANK_PAID) continue;
    totalLines++;

    const description = toText(pick(row, ...DETAILS_KEYS));
    const reference = toText(pick(row, ...REFERENCE_KEYS));
    const amount = toNumber(pick(row, ...DEBIT_KEYS)) - toNumber(pick(row, ...CREDIT_KEYS));

    // The RI number lives in Reference Number; the free-text Description is
    // checked too, since a handful carry it there instead.
    const riReferences = extractRiRefs(`${reference ?? ""} ${description ?? ""}`);
    if (riReferences.length === 0) untaggedCount++;

    rows.push({ txnDate: date, description, reference, amount, riReferences });
  }

  if (rows.length === 0) {
    throw new Error(
      "The Account Transactions table was found but no bank-paid line was booked to a " +
        'reimbursement account (a name containing "reimb"). Check this is the right export and ' +
        "covers a period that actually has bank-paid reimbursements.",
    );
  }

  if (untaggedCount > 0) {
    warnings.push(
      `${untaggedCount} bank-paid reimbursement line(s) carried no RI number in their reference - ` +
        "they will show as unmatched until one is added and the file is re-uploaded.",
    );
  }

  const dates = rows.map((r) => r.txnDate).sort();

  return {
    rows,
    periodStart: dates[0] ?? null,
    periodEnd: dates[dates.length - 1] ?? null,
    untaggedCount,
    warnings,
    detected: {
      sheetName: found.sheetName,
      headerRow: found.headerRow,
      columns: found.rawHeaders.filter(Boolean),
      totalLines,
    },
  };
}

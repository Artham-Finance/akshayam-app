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
  type Cell,
  type DateOrder,
  type SheetTable,
} from "./workbook";

/**
 * Zoho Books General Ledger parser.
 *
 * Zoho exports the GL in one of two shapes and which one you get depends on
 * the export options, so both are supported:
 *
 *   flat       every row carries its own Account column
 *   sectioned  the account name sits on its own row, and the transactions
 *              beneath it belong to that account until the next such row
 *
 * Rows we deliberately drop: opening/closing balance lines and subtotals.
 * Opening balances come from the trial balance upload instead - taking them
 * from both sources would double the balance sheet.
 */

export interface ParsedGlRow {
  date: string;
  accountName: string;
  vertical: string | null;
  description: string | null;
  txnType: string | null;
  txnNumber: string | null;
  reference: string | null;
  contactName: string | null;
  debit: number;
  credit: number;
}

export interface GlParseResult {
  rows: ParsedGlRow[];
  /** account name -> Zoho account_type, when the export carried that column */
  accounts: Map<string, string | null>;
  verticals: Set<string>;
  periodStart: string | null;
  periodEnd: string | null;
  totalDebit: number;
  totalCredit: number;
  warnings: string[];
  detected: {
    layout: "flat" | "sectioned";
    sheetName: string;
    headerRow: number;
    columns: string[];
    dateOrder: DateOrder;
    verticalColumn: string | null;
    accountTypeColumn: string | null;
  };
}

const DATE_KEYS = ["date", "transaction_date", "txn_date", "invoice_date"];
const DEBIT_KEYS = ["debit", "debit_amount", "debits"];
const CREDIT_KEYS = ["credit", "credit_amount", "credits"];
const ACCOUNT_KEYS = ["account", "account_name", "ledger", "ledger_name", "particulars"];
const ACCOUNT_TYPE_KEYS = ["account_type", "account_group", "type"];
const DESC_KEYS = ["description", "transaction_details", "narration", "details", "notes"];
const TYPE_KEYS = ["transaction_type", "txn_type", "voucher_type"];
// "entity_number" is Zoho's own name for the document number - the invoice,
// receipt or journal number the posting came from. It is the only column that
// ties a ledger row back to the invoice register, so without it a receivables
// figure cannot be reconciled to the control account at all.
const NUMBER_KEYS = [
  "transaction_number", "entity_number", "transaction", "entry_number",
  "voucher_number", "txn_number",
];
const REF_KEYS = ["reference_number", "reference", "ref"];
const CONTACT_KEYS = ["contact_name", "customer_name", "vendor_name", "contact", "customer", "party"];

/** Column names that plausibly hold the reporting tag / vertical. */
const VERTICAL_HINTS = [
  "reporting_tag", "reporting_tags", "tag", "tags", "cost_center", "cost_centre",
  "vertical", "verticals", "department", "division", "segment", "branch", "location",
  "business_unit", "profit_center", "profit_centre", "practice", "service_line",
];

/** Rows that are structural, not transactions. */
const SKIP_ROW = /^(total|opening balance|closing balance|balance|sub\s*total|grand total)\b/i;

function findVerticalColumn(headers: string[]): string | null {
  const known = headers.find((h) => h && VERTICAL_HINTS.includes(h));
  if (known) return known;
  // Zoho names the column after the tag group, e.g. "Vertical Name" or "Practice Area".
  return headers.find((h) => h && /(tag|vertical|segment|division|department|practice)/.test(h)) ?? null;
}

function firstKeyPresent(headers: string[], keys: string[]): string | null {
  return keys.find((k) => headers.includes(k)) ?? null;
}

export async function parseGeneralLedger(input: Buffer | ArrayBuffer): Promise<GlParseResult> {
  const workbook = await readWorkbook(input);

  let table: SheetTable | null = null;
  workbook.eachSheet((sheet: ExcelJS.Worksheet) => {
    if (table) return;
    const found = findTable(sheet, [DATE_KEYS, [...DEBIT_KEYS, ...CREDIT_KEYS]]);
    if (found) table = found;
  });

  if (!table) {
    throw new Error(
      "Could not find a general ledger table. Expected columns for date and debit/credit. " +
        "Export from Zoho Books via Reports > Accountant > General Ledger.",
    );
  }

  // TypeScript cannot see through eachSheet's callback assignment.
  const found: SheetTable = table;
  const warnings: string[] = [];
  const headers = found.headers.filter(Boolean);

  const dateKey = firstKeyPresent(headers, DATE_KEYS)!;
  const accountKey = firstKeyPresent(headers, ACCOUNT_KEYS);
  const accountTypeKey = firstKeyPresent(headers, ACCOUNT_TYPE_KEYS);
  const verticalKey = findVerticalColumn(headers);

  const dateOrder = detectDateOrder(found.rows.map((r) => r[dateKey]));

  // Flat layout if an account column exists and is populated on rows that also
  // have a date. A sectioned export may still have an "account" header whose
  // cells are only filled on the section rows.
  const datedRows = found.rows.filter((r) => toDateISO(r[dateKey], dateOrder) !== null);
  const accountFillRate = accountKey
    ? datedRows.filter((r) => toText(r[accountKey])).length / Math.max(datedRows.length, 1)
    : 0;
  const layout: "flat" | "sectioned" = accountFillRate > 0.8 ? "flat" : "sectioned";

  const rows: ParsedGlRow[] = [];
  const accounts = new Map<string, string | null>();
  const verticals = new Set<string>();
  let currentAccount: string | null = null;
  let skippedNoAccount = 0;
  let skippedNoDate = 0;

  for (const row of found.rows) {
    if (isRepeatedRow(row)) continue; // spilled title/footer line
    const labelCandidates = [
      accountKey ? toText(row[accountKey]) : null,
      ...headers.map((h) => toText(row[h])).filter(Boolean),
    ];
    const firstLabel = labelCandidates.find(Boolean) ?? null;

    const date = toDateISO(row[dateKey], dateOrder);

    if (date === null) {
      // Not a transaction. In a sectioned export this is either the account
      // heading or a total line.
      if (firstLabel && !SKIP_ROW.test(firstLabel)) {
        const populated = headers.filter((h) => toText(row[h])).length;
        // An account heading is a lone text cell with no amounts against it.
        const hasAmount =
          toNumber(pick(row, ...DEBIT_KEYS)) !== 0 || toNumber(pick(row, ...CREDIT_KEYS)) !== 0;
        if (populated <= 2 && !hasAmount) {
          currentAccount = firstLabel;
          if (!accounts.has(currentAccount)) {
            accounts.set(currentAccount, accountTypeKey ? toText(row[accountTypeKey]) : null);
          }
          continue;
        }
      }
      skippedNoDate++;
      continue;
    }

    if (firstLabel && SKIP_ROW.test(firstLabel)) continue;

    const accountName =
      layout === "flat" && accountKey ? toText(row[accountKey]) ?? currentAccount : currentAccount;

    if (!accountName) {
      skippedNoAccount++;
      continue;
    }

    const debitRaw = toNumber(pick(row, ...DEBIT_KEYS));
    const creditRaw = toNumber(pick(row, ...CREDIT_KEYS));
    let debit = debitRaw;
    let credit = creditRaw;

    // Some exports carry a single signed Amount column instead.
    if (debit === 0 && credit === 0) {
      const amount = toNumber(pick(row, "amount", "amount_inr", "value"));
      if (amount > 0) debit = amount;
      else if (amount < 0) credit = -amount;
      else continue; // genuinely a zero-value row
    }

    // A negative debit is a credit in disguise; normalise so both stay positive.
    if (debit < 0) {
      credit += -debit;
      debit = 0;
    }
    if (credit < 0) {
      debit += -credit;
      credit = 0;
    }

    const vertical = verticalKey ? toTag(row[verticalKey]) : null;
    if (vertical) verticals.add(vertical);

    if (!accounts.has(accountName)) {
      accounts.set(accountName, accountTypeKey ? toText(row[accountTypeKey]) : null);
    }

    rows.push({
      date,
      accountName,
      vertical,
      description: toText(pick(row, ...DESC_KEYS)),
      txnType: toText(pick(row, ...TYPE_KEYS)),
      txnNumber: toText(pick(row, ...NUMBER_KEYS)),
      reference: toText(pick(row, ...REF_KEYS)),
      contactName: toText(pick(row, ...CONTACT_KEYS)),
      debit,
      credit,
    });
  }

  if (rows.length === 0) {
    throw new Error(
      "The general ledger table was found but no transaction rows could be read. " +
        "Check that the export covers a date range with postings.",
    );
  }

  const dates = rows.map((r) => r.date).sort();
  const periodStart = dates[0] ?? null;
  const periodEnd = dates[dates.length - 1] ?? null;

  if (!verticalKey) {
    warnings.push(
      "No reporting tag column was found, so vertical-wise P&L is not available from this file. " +
        "Re-export with reporting tags included, or set up cost allocation in Settings.",
    );
  }
  if (!accountTypeKey) {
    warnings.push(
      "No account type column was found. Accounts were classified from their names, " +
        "so please review the mapping in Settings before sharing the report.",
    );
  }
  if (skippedNoAccount > 0) {
    warnings.push(`${skippedNoAccount} row(s) had no identifiable account and were skipped.`);
  }

  // Debits and credits over a full ledger must agree. A gap means rows were
  // missed or double read, which is worth saying out loud before anyone
  // presents the numbers.
  const totalDebit = rows.reduce((sum, r) => sum + r.debit, 0);
  const totalCredit = rows.reduce((sum, r) => sum + r.credit, 0);
  const gap = Math.abs(totalDebit - totalCredit);
  if (gap > 1) {
    warnings.push(
      `Debits (${totalDebit.toFixed(2)}) and credits (${totalCredit.toFixed(2)}) differ by ` +
        `${gap.toFixed(2)}. This usually means the export is a partial period or excludes some accounts.`,
    );
  }

  return {
    rows,
    accounts,
    verticals,
    periodStart,
    periodEnd,
    totalDebit,
    totalCredit,
    warnings,
    detected: {
      layout,
      sheetName: found.sheetName,
      headerRow: found.headerRow,
      columns: found.rawHeaders.filter(Boolean),
      dateOrder,
      verticalColumn: verticalKey,
      accountTypeColumn: accountTypeKey,
    },
  };
}

/** Exposed for the trial-balance parser, which shares the coercion rules. */
export const glInternals = { DATE_KEYS, ACCOUNT_KEYS, SKIP_ROW } as const;
export type { Cell };

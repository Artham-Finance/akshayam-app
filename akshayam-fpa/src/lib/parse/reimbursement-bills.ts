import {
  findTable,
  pick,
  readWorkbook,
  toDateISO,
  toNumber,
  toTag,
  toText,
  type SheetTable,
} from "./workbook";

/**
 * Zoho Books item-wise Bills export - read for one thing only: the RI number
 * typed into a reimbursable expense line at the time the credit-card bill (or
 * any other bill) was booked.
 *
 * The General Ledger export the rest of the app reads never carries this -
 * Zoho's GL report collapses a bill's line items down to one row per
 * account/vertical, and the RI number lives in the line's own free-text
 * Description, which the GL report drops. This file is the one place it
 * survives, so only rows booked to a reimbursement account are kept; every
 * other line on the same bill (rent, salaries, telephone, ...) is not
 * reimbursable expense and is ignored here - the general ledger already
 * carries it.
 */

const ACCOUNT_KEYS = ["account"];
const DESC_KEYS = ["description", "item_description"];
const AMOUNT_KEYS = ["item_total", "amount", "total"];
const DATE_KEYS = ["bill_date", "date"];
const CUSTOMER_KEYS = ["customer_name", "customer"];
const VENDOR_KEYS = ["vendor_name", "vendor"];
const BILL_NUMBER_KEYS = ["bill_number"];
/** RBJV's export names this column "Vertical"; Akshayam's names it under the
 *  line-item tag group instead. Both normalise differently, so both are tried. */
const VERTICAL_KEYS = ["vertical", "lineitem_tag_vertical"];

/** Booked to the account this file exists to read - everything else on the bill is not. */
const REIMBURSEMENT_ACCOUNT = /reimb/i;

/**
 * An RI number as typed by hand: "RI-2627-0008", "RI-AKS-2627-0016",
 * "RI 2627-0334", sometimes two on one line ("RI-2627-0013, RI-2627-0042").
 * Matched loosely and normalised afterwards, because the point is to catch
 * what a person actually typed, not to enforce a house style on them.
 */
const RI_REF = /RI[\s-]*(?:AKS[\s-]*)?\d{3,4}[\s-]+\d{3,4}/gi;

/**
 * The strict match key: upper-cased, every non-alphanumeric character
 * stripped, so "RI-2627-0008" and "RI 2627 0008" are the same key. Used only
 * for comparing one side to the other - never shown, since it throws away
 * the separators that make a reference readable.
 */
export function normaliseRiRef(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** The same reference, kept readable: one dash between each part, whatever the source typed. */
function prettyRiRef(raw: string): string {
  return raw.toUpperCase().trim().replace(/[\s-]+/g, "-");
}

/** Readable references, de-duplicated by their strict match key. */
export function extractRiRefs(text: string | null): string[] {
  if (!text) return [];
  const matches = text.match(RI_REF) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of matches) {
    const key = normaliseRiRef(raw);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(prettyRiRef(raw));
  }
  return out;
}

export interface ReimbursementBillRow {
  billDate: string;
  vendorName: string | null;
  billNumber: string | null;
  description: string | null;
  customerName: string | null;
  vertical: string | null;
  amount: number;
  riReferences: string[];
}

export interface ReimbursementBillsParseResult {
  rows: ReimbursementBillRow[];
  verticals: Set<string>;
  periodStart: string | null;
  periodEnd: string | null;
  /** reimbursement lines whose description carried no RI reference at all */
  untaggedCount: number;
  warnings: string[];
  detected: { sheetName: string; headerRow: number; columns: string[]; totalLines: number };
}

export async function parseReimbursementBills(
  input: Buffer | ArrayBuffer,
): Promise<ReimbursementBillsParseResult> {
  const workbook = await readWorkbook(input);

  let table: SheetTable | null = null;
  workbook.eachSheet((sheet) => {
    if (table) return;
    const found = findTable(sheet, [DATE_KEYS, ACCOUNT_KEYS, DESC_KEYS]);
    if (found) table = found;
  });

  if (!table) {
    throw new Error(
      "Could not find an itemised Bills table. Expected the Zoho Books Bills export with " +
        "Bill Date, Account and Description columns (Purchases → Bills → Export).",
    );
  }
  // TypeScript cannot see through eachSheet's callback assignment.
  const found: SheetTable = table;

  const warnings: string[] = [];
  const rows: ReimbursementBillRow[] = [];
  const verticals = new Set<string>();
  let totalLines = 0;
  let untaggedCount = 0;

  for (const row of found.rows) {
    const date = toDateISO(pick(row, ...DATE_KEYS));
    const account = toText(pick(row, ...ACCOUNT_KEYS));
    if (date === null || !account) continue;
    if (!REIMBURSEMENT_ACCOUNT.test(account)) continue;
    totalLines++;

    const amount = toNumber(pick(row, ...AMOUNT_KEYS));
    const description = toText(pick(row, ...DESC_KEYS));
    const vertical = toTag(pick(row, ...VERTICAL_KEYS));
    if (vertical) verticals.add(vertical);

    const riReferences = extractRiRefs(description);
    if (riReferences.length === 0) untaggedCount++;

    rows.push({
      billDate: date,
      vendorName: toText(pick(row, ...VENDOR_KEYS)),
      billNumber: toText(pick(row, ...BILL_NUMBER_KEYS)),
      description,
      customerName: toText(pick(row, ...CUSTOMER_KEYS)),
      vertical,
      amount,
      riReferences,
    });
  }

  if (rows.length === 0) {
    throw new Error(
      "The Bills table was found but no line was booked to a reimbursement account " +
        "(a name containing \"reimb\"). Check this is the right export and covers bills " +
        "that actually carry RI expense lines.",
    );
  }

  if (untaggedCount > 0) {
    warnings.push(
      `${untaggedCount} reimbursement line(s) carried no RI number in their description - ` +
        "they will show as unmatched until one is added and the file is re-uploaded.",
    );
  }

  const dates = rows.map((r) => r.billDate).sort();

  return {
    rows,
    verticals,
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

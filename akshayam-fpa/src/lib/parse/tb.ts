import type ExcelJS from "exceljs";
import {
  findTable,
  isRepeatedRow,
  pick,
  readWorkbook,
  toNumber,
  toText,
  type Cell,
  type SheetTable,
} from "./workbook";

/**
 * Zoho Books Trial Balance parser.
 *
 * Used once a year: the closing trial balance of the prior financial year
 * becomes the opening balance sheet, which the general ledger alone cannot
 * provide.
 */

export interface ParsedTbRow {
  accountName: string;
  accountCode: string | null;
  accountType: string | null;
  debit: number;
  credit: number;
}

/**
 * Which column the balances are taken from.
 *   opening   the Opening Balance column - the position at the start of the
 *             period, which is what seeds the opening balance sheet
 *   closing   the Closing Balance column
 *   movement  the Debit/Credit columns, which in a period trial balance are
 *             movements for the period, not balances
 */
export type TbBasis = "opening" | "closing" | "movement";

export interface TbParseResult {
  rows: ParsedTbRow[];
  totalDebit: number;
  totalCredit: number;
  basis: TbBasis;
  /** bases this particular file can support */
  available: TbBasis[];
  warnings: string[];
  detected: { sheetName: string; headerRow: number; columns: string[]; sections: string[] };
}

const ACCOUNT_KEYS = ["account", "account_name", "particulars", "ledger", "ledger_name"];
const CODE_KEYS = ["account_code", "code", "gl_code"];
const TYPE_KEYS = ["account_type", "account_group", "type", "group"];
const DEBIT_KEYS = ["debit", "debit_balance", "debit_amount", "dr"];
const CREDIT_KEYS = ["credit", "credit_balance", "credit_amount", "cr"];

const OPENING_KEYS = ["opening_balance", "opening", "opening_bal"];
const CLOSING_KEYS = ["closing_balance", "closing", "closing_bal", "balance"];

// "Total for Accounts Receivable" is a rollup of the rows above it. Zoho's
// hierarchical trial balance carries a parent's own balance on its own row and
// the children beneath it, so every non-total row can be taken at face value -
// but the total rows must go or everything doubles.
const SKIP_ROW = /^(total|grand total|sub\s*total)\b/i;

/**
 * Section headings in a Zoho trial balance: a lone word in the account column
 * with every figure blank, e.g. "Assets" / "Liabilities" / "Equities".
 *
 * They matter because a trial balance carries no account_type column. Without
 * the section, "Advance tax" and "TDS-2526-SCAN HOLDINGS" have to be guessed
 * from their names alone, and a debit balance guessed onto the liabilities
 * side misstates both halves of the opening balance sheet. The heading already
 * says which side the account is on - it just has to be read.
 */
const SECTION_ROW: Record<string, string> = {
  asset: "asset",
  assets: "asset",
  liability: "liability",
  liabilities: "liability",
  equity: "equity",
  equities: "equity",
  income: "income",
  revenue: "income",
  expense: "expense",
  expenses: "expense",
};

/** A row whose only populated cell is the account name. */
function isSectionHeading(row: Record<string, Cell>, accountName: string): string | null {
  const section = SECTION_ROW[accountName.trim().toLowerCase()];
  if (!section) return null;

  for (const [key, value] of Object.entries(row)) {
    if (ACCOUNT_KEYS.includes(key)) continue;
    if (value !== null && String(value).trim() !== "") return null;
  }
  return section;
}

export async function parseTrialBalance(
  input: Buffer | ArrayBuffer,
  basis: TbBasis = "opening",
): Promise<TbParseResult> {
  const workbook = await readWorkbook(input);

  let table: SheetTable | null = null;
  workbook.eachSheet((sheet: ExcelJS.Worksheet) => {
    if (table) return;
    const found = findTable(sheet, [ACCOUNT_KEYS, [...DEBIT_KEYS, ...CREDIT_KEYS]]);
    if (found) table = found;
  });

  if (!table) {
    throw new Error(
      "Could not find a trial balance table. Expected an account column plus debit/credit. " +
        "Export from Zoho Books via Reports > Accountant > Trial Balance.",
    );
  }

  const found: SheetTable = table;
  const rows: ParsedTbRow[] = [];
  const warnings: string[] = [];
  const headers = found.headers.filter(Boolean);

  const has = (keys: string[]) => keys.some((k) => headers.includes(k));
  const available: TbBasis[] = [];
  if (has(OPENING_KEYS)) available.push("opening");
  if (has(CLOSING_KEYS)) available.push("closing");
  if (has(DEBIT_KEYS) || has(CREDIT_KEYS)) available.push("movement");

  let effective = basis;
  if (!available.includes(effective)) {
    effective = available[0] ?? "movement";
    if (available.length > 0) {
      warnings.push(
        `This file has no ${basis} balance column, so the ${effective} figures were used instead.`,
      );
    }
  }

  let section: string | null = null;
  const sections = new Set<string>();

  for (const row of found.rows) {
    if (isRepeatedRow(row)) continue;
    const accountName = toText(pick(row, ...ACCOUNT_KEYS));
    if (!accountName || SKIP_ROW.test(accountName)) continue;

    const heading = isSectionHeading(row, accountName);
    if (heading) {
      section = heading;
      sections.add(heading);
      continue;
    }

    let debit = 0;
    let credit = 0;

    if (effective === "movement") {
      debit = toNumber(pick(row, ...DEBIT_KEYS));
      credit = toNumber(pick(row, ...CREDIT_KEYS));
      if (debit === 0 && credit === 0) continue;
    } else {
      // A single signed balance column: positive is a debit balance.
      const keys = effective === "opening" ? OPENING_KEYS : CLOSING_KEYS;
      const balance = toNumber(pick(row, ...keys));
      if (balance === 0) continue;
      if (balance > 0) debit = balance;
      else credit = -balance;
    }

    if (debit < 0) {
      credit += -debit;
      debit = 0;
    }
    if (credit < 0) {
      debit += -credit;
      credit = 0;
    }

    rows.push({
      accountName,
      accountCode: toText(pick(row, ...CODE_KEYS)),
      // The section heading is the fallback, never the override: a file that
      // does carry an account_type column knows more than the heading does.
      accountType: toText(pick(row, ...TYPE_KEYS)) ?? section,
      debit,
      credit,
    });
  }

  if (rows.length === 0) {
    throw new Error("The trial balance table was found but contained no account rows.");
  }

  if (sections.size === 0 && !has(TYPE_KEYS)) {
    warnings.push(
      "This trial balance carries neither an account type column nor Assets/Liabilities " +
        "section headings, so each account's reporting line was guessed from its name alone. " +
        "Check Settings > Account mapping before relying on the opening balance sheet.",
    );
  }

  const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
  const gap = Math.abs(totalDebit - totalCredit);
  if (gap > 1) {
    warnings.push(
      `Trial balance does not balance: debits ${totalDebit.toFixed(2)} vs credits ` +
        `${totalCredit.toFixed(2)}, a difference of ${gap.toFixed(2)}. ` +
        "The opening balance sheet will not tie until this is resolved.",
    );
  }

  return {
    rows,
    totalDebit,
    totalCredit,
    basis: effective,
    available,
    warnings,
    detected: {
      sheetName: found.sheetName,
      headerRow: found.headerRow,
      columns: found.rawHeaders.filter(Boolean),
      sections: [...sections],
    },
  };
}

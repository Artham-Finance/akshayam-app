/**
 * Auto-mapping of Zoho ledger accounts to the presentation hierarchy.
 *
 * The P&L structure follows the firm's own convention:
 *   direct costs   consultancy charges, VPP, professional fees, staff salary
 *   establishment  office rent, electricity, building maintenance
 *   overheads      everything else
 *   reimbursements MCA fees paid by card and recharged to clients, shown net
 *   drawings       partners' drawings, below PAT and outside EBITDA
 *
 * This runs once per newly-discovered account and is a *suggestion*: every
 * account lands in the settings screen where it can be re-pointed, and anything
 * we could not place confidently is flagged rather than quietly dumped into
 * "Overheads". A silent misclassification is the failure mode that erodes trust
 * in a management report, so we would rather ask.
 */

export type Statement = "pnl" | "bs" | "cf" | "none";
export type CfCategory =
  | "cash"
  | "non_cash_addback"
  | "wc_operating"
  | "investing"
  | "financing"
  | "tax"
  | "pnl";

export interface MappingSuggestion {
  statement: Statement;
  groupCode: string | null;
  cfCategory: CfCategory | null;
  /** high = safe to auto-apply, low = surface for review before first report */
  confidence: "high" | "low";
}

/** Zoho's account_type -> where it belongs, before name-based refinement. */
const BY_ZOHO_TYPE: Record<string, Omit<MappingSuggestion, "confidence">> = {
  income: { statement: "pnl", groupCode: "revenue", cfCategory: "pnl" },
  other_income: { statement: "pnl", groupCode: "other_income", cfCategory: "pnl" },
  cost_of_goods_sold: { statement: "pnl", groupCode: "direct_cost", cfCategory: "pnl" },
  expense: { statement: "pnl", groupCode: "overheads", cfCategory: "pnl" },
  other_expense: { statement: "pnl", groupCode: "overheads", cfCategory: "pnl" },

  cash: { statement: "bs", groupCode: "cash", cfCategory: "cash" },
  bank: { statement: "bs", groupCode: "cash", cfCategory: "cash" },
  accounts_receivable: { statement: "bs", groupCode: "receivables", cfCategory: "wc_operating" },
  stock: { statement: "bs", groupCode: "other_ca", cfCategory: "wc_operating" },
  other_current_asset: { statement: "bs", groupCode: "other_ca", cfCategory: "wc_operating" },
  fixed_asset: { statement: "bs", groupCode: "fixed_assets", cfCategory: "investing" },
  other_asset: { statement: "bs", groupCode: "other_nca", cfCategory: "investing" },

  accounts_payable: { statement: "bs", groupCode: "payables", cfCategory: "wc_operating" },
  other_current_liability: { statement: "bs", groupCode: "other_liab", cfCategory: "wc_operating" },
  other_liability: { statement: "bs", groupCode: "other_liab", cfCategory: "wc_operating" },
  credit_card: { statement: "bs", groupCode: "borrowings", cfCategory: "financing" },
  long_term_liability: { statement: "bs", groupCode: "borrowings", cfCategory: "financing" },
  equity: { statement: "bs", groupCode: "equity", cfCategory: "financing" },
};

interface NameRule {
  match: RegExp;
  groupCode: string;
  cfCategory?: CfCategory;
}

/**
 * Client recharges. Both sides carry the same word and must land in the same
 * group so they net: the expense is paid on the firm's credit card and
 * recovered from the client, so grossing it up would overstate both the cost
 * base and other income. Note Zoho carries the misspelling "reimbursment".
 */
const REIMBURSEMENT_RULE = /\breimburs\w*/i;

/** Partners' drawings sit below PAT and never inside EBITDA. */
const DRAWINGS_RULE = /\b(drawings?|partners?.{0,3}\s*(remuneration|drawings?))\b/i;

/** Refinements applied to P&L expense accounts, in priority order. */
const EXPENSE_NAME_RULES: NameRule[] = [
  {
    match: /\b(depreciation|amortisation|amortization|impairment)\b/i,
    groupCode: "depreciation",
    cfCategory: "non_cash_addback",
  },
  {
    // Real ledgers name these "Bank Charges", "Finance Costs" and
    // "Bank Fees and Charges", so allow the plural and the intervening word.
    //
    // The cash-flow category is "pnl", not "financing": interest is a cost of
    // the period and belongs inside profit before tax. Bucketing it as
    // financing would leave the cash flow's opening line labelled "Profit
    // Before Tax" while showing something else, and a management report whose
    // first line disagrees with the P&L is not worth reading.
    match: /\b(interest|bank\s+(fees|charges?)|loan processing|finance costs?|financial charges?)\b/i,
    groupCode: "finance_cost",
    cfCategory: "pnl",
  },
  {
    match: /\b(income tax|current tax|deferred tax|tax expense)\b/i,
    groupCode: "tax",
    cfCategory: "tax",
  },
  {
    // Direct delivery cost: fee-earning effort and the outside help bought in
    // to deliver it. Staff salary counts here, staff welfare does not.
    match:
      /\b(consultancy charges?|consulting charges?|\bvpp\b|professional fees?|professional charges?|salar\w*|wages?|payroll|performance incentive|incentives?|bonus|gratuity|provident|\bpf\b|\besi\b|leave encash\w*|subcontract\w*|sub-contract\w*|outsourc\w*)\b/i,
    groupCode: "direct_cost",
  },
  {
    // Establishment: the cost of having premises at all.
    match:
      /\b(office\s+rent|rent\s+expense|rent|electricity|power\s+charges?|\beb\s+charges?|(building|premises|office)\s+maint\w*)\b/i,
    groupCode: "establishment_cost",
  },
  {
    match:
      /\b(filing fees?|government fees?|statutory fees?|roc\s|mca\s|challan|stamp duty)\w*/i,
    groupCode: "direct_cost",
  },
];

/**
 * Balance-sheet signals strong enough to override an expense keyword.
 *
 * These are checked FIRST when no account_type column is available, because
 * several liability and asset accounts contain words that otherwise read as
 * P&L lines: "Salaries Payable" is not a direct cost, and "Accumulated
 * Depreciation" is not depreciation expense. Getting this wrong is worse than
 * leaving an account unclassified - the contra account nets against the real
 * expense and silently understates it.
 */
const BS_OVERRIDE_RULES: NameRule[] = [
  {
    // Sits under fixed assets on the balance sheet, but its movement is the
    // depreciation charge - a non-cash add-back, not a cash purchase. Keeping
    // it out of investing is what leaves that section showing real additions.
    match: /\baccumulated\s+(depreciation|amortisation|amortization)\b/i,
    groupCode: "fixed_assets",
    cfCategory: "non_cash_addback",
  },
  {
    match: /\b(payable|payables|creditor|creditors)\b/i,
    groupCode: "payables",
    cfCategory: "wc_operating",
  },
  {
    match: /\b(receivable|receivables|debtor|debtors)\b/i,
    groupCode: "receivables",
    cfCategory: "wc_operating",
  },
  {
    match: /\b(provision|provisions|accrued|accruals?|outstanding expenses?)\b/i,
    groupCode: "other_liab",
    cfCategory: "wc_operating",
  },
  {
    match: /\b(prepaid|advances?|deposits?|imprest|recoverable)\b/i,
    groupCode: "other_ca",
    cfCategory: "wc_operating",
  },
  {
    // Indian statutory ledgers are balance-sheet control accounts, not expenses.
    match: /\b(tds|tcs|gst|cgst|sgst|igst|statutory dues?|duties and taxes)\b/i,
    groupCode: "other_liab",
    cfCategory: "wc_operating",
  },
  {
    match: /\bunadjusted\s+credits?\b/i,
    groupCode: "other_liab",
    cfCategory: "wc_operating",
  },
  {
    // Deliberately excludes "phone"/"mobile" - "Telephone Expense" would match.
    match: /\b(furniture|fixtures?|computers?|equipment|vehicles?|cars?|machinery|leasehold|building|land|printers?|cameras?|cctv|air\s*conditioner|server|laptops?|electrical fitting)\b/i,
    groupCode: "fixed_assets",
    cfCategory: "investing",
  },
];

/** Refinements applied to balance-sheet accounts. */
const BS_NAME_RULES: NameRule[] = [
  {
    match: /\b(reserves?|surplus|retained earnings?|accumulated (profit|loss)|profit\s*(and|&)\s*loss|p\s*&\s*l)\b/i,
    groupCode: "reserves",
    cfCategory: "financing",
  },
  {
    match: /\b(share capital|equity share|preference share|capital account|partner.?s capital)\b/i,
    groupCode: "equity",
    cfCategory: "financing",
  },
  {
    match: /\b(loan|borrowing|debenture|overdraft|\bcc\b|term loan|working capital limit)\b/i,
    groupCode: "borrowings",
    cfCategory: "financing",
  },
  {
    match: /\b(goodwill|software|trademark|patent|intangible|website)\b/i,
    groupCode: "intangibles",
    cfCategory: "investing",
  },
  {
    match: /\b(investment|mutual fund|fixed deposit|\bfd\b)\b/i,
    groupCode: "investments",
    cfCategory: "investing",
  },
  {
    // Set-up costs carried forward rather than written off. Akshayam's IFSC
    // branch capitalised a year of them, and they are not current assets.
    match: /\b(pre[\s-]?operative|preoperative|preliminary|pre[\s-]?incorporation)\b/i,
    groupCode: "other_nca",
    cfCategory: "investing",
  },
  {
    match: /\bdeferred tax\b/i,
    groupCode: "other_nca",
    cfCategory: "tax",
  },
  {
    match: /\bcredit card\b/i,
    groupCode: "borrowings",
    cfCategory: "financing",
  },
  {
    match: /\badvances?\s+(received|from customers?)\b/i,
    groupCode: "other_liab",
    cfCategory: "wc_operating",
  },
];

/**
 * Coarse types, from a sectioned trial balance.
 *
 * A trial balance names the side ("Assets") but not the sub-type, so the
 * fallback is the vaguest group on that side. It is a weak answer on its own,
 * which is why it is returned as low confidence - but it is the *right side*,
 * and that is worth far more than a name-only guess that can land a debit
 * balance in liabilities.
 */
const BY_SECTION: Record<string, Omit<MappingSuggestion, "confidence">> = {
  asset: { statement: "bs", groupCode: "other_ca", cfCategory: "wc_operating" },
  liability: { statement: "bs", groupCode: "other_liab", cfCategory: "wc_operating" },
  equity: { statement: "bs", groupCode: "equity", cfCategory: "financing" },
};
// "Income" and "Expense" sections need nothing extra: they are already keys in
// BY_ZOHO_TYPE, so they take the ordinary P&L path with its expense rules.

const ASSET_GROUPS = new Set([
  "fixed_assets", "intangibles", "investments", "other_nca", "receivables", "cash", "other_ca",
]);
const LIABILITY_GROUPS = new Set(["equity", "reserves", "borrowings", "payables", "other_liab"]);

/**
 * Indian statutory ledgers on the asset side: TDS deducted by customers, input
 * GST, advance tax. They are current assets, not trade receivables - a name
 * rule reading "TDS Receivable" as a debtor would inflate the receivables line
 * and quietly break every DSO figure computed from it.
 */
const STATUTORY_ASSET_RULE = /\b(tds|tcs|gst|cgst|sgst|igst|input tax|advance tax|withholding)\b/i;

/** A trial-balance section heading gives the side; the name refines it. */
function suggestFromSection(name: string, section: string): MappingSuggestion {
  const base = BY_SECTION[section];

  if (section === "asset" && STATUTORY_ASSET_RULE.test(name)) {
    return { statement: "bs", groupCode: "other_ca", cfCategory: "wc_operating", confidence: "high" };
  }

  // Only accept a name rule that agrees with the side we already know: on the
  // asset side "Advance received" must not become a prepayment.
  const allowed = section === "asset" ? ASSET_GROUPS : LIABILITY_GROUPS;
  for (const rule of [...BS_OVERRIDE_RULES, ...BS_NAME_RULES]) {
    if (rule.match.test(name) && allowed.has(rule.groupCode)) {
      return {
        statement: "bs",
        groupCode: rule.groupCode,
        cfCategory: rule.cfCategory ?? base.cfCategory,
        confidence: "high",
      };
    }
  }

  return { ...base, confidence: "low" };
}

/** Normalise Zoho's account_type into the keys used above. */
function normaliseType(raw: string | null | undefined): string {
  return (raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/&/g, "and");
}

/**
 * Suggest a mapping for one ledger account.
 * @param name  the Zoho account name, e.g. "Salaries and Employee Wages"
 * @param zohoType the Zoho account_type column, if the export carried one
 */
export function suggestMapping(name: string, zohoType?: string | null): MappingSuggestion {
  const type = normaliseType(zohoType);
  const base = BY_ZOHO_TYPE[type];

  if (!base) {
    // A trial-balance section heading: the side is known, the sub-type is not.
    if (type in BY_SECTION) return suggestFromSection(name, type);
    // No usable type column. Fall back to name alone and always ask for review.
    return guessFromNameOnly(name);
  }

  if (base.statement === "pnl") {
    // Checked ahead of the expense rules because it must catch the income side
    // of the recharge too, so both halves land in one group and net.
    if (REIMBURSEMENT_RULE.test(name)) {
      return { statement: "pnl", groupCode: "reimbursements", cfCategory: "pnl", confidence: "high" };
    }

    const isExpense = /expense|cost_of_goods_sold/.test(type);
    if (isExpense) {
      if (DRAWINGS_RULE.test(name)) {
        return {
          statement: "pnl",
          groupCode: "partner_drawings",
          cfCategory: "financing",
          confidence: "high",
        };
      }
      for (const rule of EXPENSE_NAME_RULES) {
        if (rule.match.test(name)) {
          return {
            statement: "pnl",
            groupCode: rule.groupCode,
            cfCategory: rule.cfCategory ?? "pnl",
            confidence: "high",
          };
        }
      }
      // Anything with no keyword hit is an overhead by definition here, which
      // is the firm's own rule, so this is a confident answer rather than a
      // fallback.
      return { ...base, confidence: "high" };
    }
    return { ...base, confidence: "high" };
  }

  if (DRAWINGS_RULE.test(name) && type === "equity") {
    return {
      statement: "pnl",
      groupCode: "partner_drawings",
      cfCategory: "financing",
      confidence: "low",
    };
  }

  for (const rule of BS_NAME_RULES) {
    if (rule.match.test(name)) {
      return {
        statement: "bs",
        groupCode: rule.groupCode,
        cfCategory: rule.cfCategory ?? base.cfCategory,
        confidence: "high",
      };
    }
  }

  return { ...base, confidence: "high" };
}

/**
 * Last resort when the export has no account_type column at all.
 *
 * Order matters, and each step earns its place:
 *   1. unambiguous balance-sheet words ("Payable", "Accumulated Depreciation")
 *   2. expense keywords - so "Bank Charges" is a finance cost, not a bank
 *      account, and "Interest on Bank Loan" is not a borrowing
 *   3. remaining balance-sheet words, then bank/cash by name
 * Everything returned here is low confidence by design, so it lands on the
 * review screen rather than being trusted outright.
 */
function guessFromNameOnly(name: string): MappingSuggestion {
  const asBalanceSheet = (rule: NameRule): MappingSuggestion => ({
    statement: "bs",
    groupCode: rule.groupCode,
    cfCategory: rule.cfCategory ?? null,
    confidence: "low",
  });

  if (REIMBURSEMENT_RULE.test(name)) {
    return { statement: "pnl", groupCode: "reimbursements", cfCategory: "pnl", confidence: "low" };
  }
  if (DRAWINGS_RULE.test(name)) {
    return {
      statement: "pnl",
      groupCode: "partner_drawings",
      cfCategory: "financing",
      confidence: "low",
    };
  }

  for (const rule of BS_OVERRIDE_RULES) {
    if (rule.match.test(name)) return asBalanceSheet(rule);
  }

  for (const rule of EXPENSE_NAME_RULES) {
    if (rule.match.test(name)) {
      return {
        statement: "pnl",
        groupCode: rule.groupCode,
        cfCategory: rule.cfCategory ?? "pnl",
        confidence: "low",
      };
    }
  }

  for (const rule of BS_NAME_RULES) {
    if (rule.match.test(name)) return asBalanceSheet(rule);
  }
  if (/\b(bank|cash in hand|petty cash|hdfc|icici|axis|sbi|kotak|yes bank|idfc|indusind)\b/i.test(name)) {
    return { statement: "bs", groupCode: "cash", cfCategory: "cash", confidence: "low" };
  }

  if (/\b(sales|revenue|fees|income|receipts?|billing)\b/i.test(name)) {
    return { statement: "pnl", groupCode: "revenue", cfCategory: "pnl", confidence: "low" };
  }

  // An expense-sounding name with no better signal becomes an overhead: it
  // keeps the amount inside the P&L, where a wrong bucket is visible, rather
  // than dropping it out of the statements where it is not.
  if (
    /\b(expenses?|charges|costs?|fees?|rates|utilities|insurance|repairs|maintenance|maintanence|travel|conveyance|petrol|fuel|printing|stationery|postage|courier|telephone|internet|subscriptions?|dues|audit|legal|welfare|staff|donations?|pooja|books|periodicals|software|promotion|entertainment|hospitality|training|membership|cleaning|security|water)\b/i.test(
      name,
    )
  ) {
    return { statement: "pnl", groupCode: "overheads", cfCategory: "pnl", confidence: "low" };
  }

  return { statement: "none", groupCode: null, cfCategory: null, confidence: "low" };
}

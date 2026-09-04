/**
 * Exercises every parser against the generated fixtures and prints what it saw.
 * Run: node scripts/check-parsers.mts <fixtures-dir>
 *
 * This is a smoke test, not a unit test suite: the point is to confirm the
 * parsers survive Zoho's real-world layout quirks before the client's files
 * arrive, and to show the detected columns so mismatches are obvious.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseGeneralLedger } from "../src/lib/parse/gl";
import { parseTrialBalance } from "../src/lib/parse/tb";
import { parseArAging, parseInvoices, parsePayments } from "../src/lib/parse/sales";
import { suggestMapping } from "../src/lib/mapping";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: node scripts/check-parsers.mts <fixtures-dir>");
  process.exit(1);
}

const read = (name: string) => readFileSync(join(dir, name));
let failures = 0;

function check(label: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`   ok   ${label}${detail ? ` (${detail})` : ""}`);
  } else {
    failures++;
    console.log(`   FAIL ${label}${detail ? ` (${detail})` : ""}`);
  }
}

/* ---------- sectioned general ledger ---------- */
console.log("\n== General ledger, sectioned layout ==");
{
  const r = await parseGeneralLedger(read("gl-sectioned.xlsx"));
  console.log(`   layout=${r.detected.layout} sheet="${r.detected.sheetName}" header row ${r.detected.headerRow}`);
  console.log(`   period ${r.periodStart} .. ${r.periodEnd}`);
  console.log(`   ${r.rows.length} rows, ${r.accounts.size} accounts, verticals: ${[...r.verticals].join(", ")}`);
  console.log(`   tag column: ${r.detected.verticalColumn}`);

  check("detected sectioned layout", r.detected.layout === "sectioned");
  check("accounts picked up from section headings", r.accounts.size === 11, `${r.accounts.size}`);
  check("verticals found", r.verticals.has("GIFT") && r.verticals.has("AIF"));
  check("dd/MM dates read correctly", r.periodStart === "2025-04-05" && r.periodEnd === "2025-06-30",
    `${r.periodStart}..${r.periodEnd}`);
  check("total rows excluded", !r.rows.some((x) => /^total/i.test(x.description ?? "")));

  const debit = r.rows.reduce((s, x) => s + x.debit, 0);
  const credit = r.rows.reduce((s, x) => s + x.credit, 0);
  console.log(`   debits ${debit.toLocaleString("en-IN")} / credits ${credit.toLocaleString("en-IN")}`);
  check("ledger balances", Math.abs(debit - credit) < 1, `gap ${(debit - credit).toFixed(2)}`);

  // The "(3,500)" filing fee should have become a credit, not a negative debit.
  const filing = r.rows.filter((x) => x.accountName === "Filing Fees");
  check("bracketed negative flipped to credit", filing.length === 1 && filing[0].credit === 3500 && filing[0].debit === 0,
    JSON.stringify(filing[0]));

  const proFees = r.rows.filter((x) => x.accountName === "Professional Fees");
  check("professional fees rows attributed to their section", proFees.length === 3, `${proFees.length}`);
  check("credit amounts parsed with Indian grouping",
    proFees.reduce((s, x) => s + x.credit, 0) === 1285000,
    `${proFees.reduce((s, x) => s + x.credit, 0)}`);
  for (const w of r.warnings) console.log(`   warn: ${w}`);
}

/* ---------- flat general ledger ---------- */
console.log("\n== General ledger, flat layout, no tags ==");
{
  const r = await parseGeneralLedger(read("gl-flat.xlsx"));
  console.log(`   layout=${r.detected.layout}, ${r.rows.length} rows, ${r.accounts.size} accounts`);
  check("detected flat layout", r.detected.layout === "flat");
  check("account types captured", r.accounts.get("Consulting Income") === "Income");
  check("native Excel dates read", r.periodStart === "2025-04-05" && r.periodEnd === "2025-05-05",
    `${r.periodStart}..${r.periodEnd}`);
  check("warns about the missing tag column",
    r.warnings.some((w) => w.includes("reporting tag")));
}

/* ---------- trial balance ---------- */
console.log("\n== Trial balance ==");
{
  const r = await parseTrialBalance(read("trial-balance.xlsx"));
  console.log(`   ${r.rows.length} accounts, debit ${r.totalDebit.toLocaleString("en-IN")}, credit ${r.totalCredit.toLocaleString("en-IN")}`);
  check("all accounts read, total row dropped", r.rows.length === 7, `${r.rows.length}`);
  check("trial balance ties", Math.abs(r.totalDebit - r.totalCredit) < 1);
  // The fixture is a plain Debit/Credit trial balance with no Opening Balance
  // column, so falling back to the movement figures - and saying so - is the
  // correct behaviour. What must not appear is a warning that it does not tie.
  check("basis fell back to movement", r.basis === "movement", r.basis);
  check(
    "no balancing warning raised",
    !r.warnings.some((w) => /does not balance/i.test(w)),
    r.warnings.join("; "),
  );
}

/* ---------- invoices ---------- */
console.log("\n== Invoice details ==");
{
  const r = await parseInvoices(read("invoice-details.xlsx"));
  const usd = r.rows.find((x) => x.currency === "USD")!;
  console.log(`   ${r.rows.length} rows, verticals: ${[...r.verticals].join(", ")}`);
  console.log(`   USD invoice: amountBase=${usd.amountBase} rate=${usd.exchangeRate} -> USD ${(usd.amountBase / usd.exchangeRate).toFixed(2)}`);
  check("invoice rows read", r.rows.length === 3);
  check("USD amount left in INR base, not multiplied", usd.amountBase === 225000, `${usd.amountBase}`);
  check("verticals captured", r.verticals.has("GIFT") && r.verticals.has("AIF"));
  check("salesperson captured", r.rows[0].salesperson === "Raja", `${r.rows[0].salesperson}`);
}

/* ---------- AR aging ---------- */
console.log("\n== AR aging ==");
{
  const r = await parseArAging(read("ar-aging.xlsx"), "2025-06-30");
  const credits = r.rows.reduce((s, x) => s + x.unusedCredit, 0);
  console.log(`   ${r.rows.length} open items, outstanding ${r.totalOutstanding.toLocaleString("en-IN")}, unused credit ${credits.toLocaleString("en-IN")}`);
  check("open items read", r.rows.length === 3);
  check("outstanding totalled", r.totalOutstanding === 1015000, `${r.totalOutstanding}`);
  check("unused credit counted once per customer, not per invoice", credits === 15000, `${credits}`);
}

/* ---------- payments ---------- */
console.log("\n== Customer payments ==");
{
  const r = await parsePayments(read("customer-payments.xlsx"));
  const total = r.rows.reduce((s, x) => s + x.amountBase, 0);
  console.log(`   ${r.rows.length} payments, total ${total.toLocaleString("en-IN")}`);
  check("payments read", r.rows.length === 2);
  check("bcy amount used as the base figure", total === 731000, `${total}`);
}

/* ---------- account auto-mapping ---------- */
console.log("\n== Account auto-mapping ==");
{
  // Account names below are the real ones from the RBJV ledger.
  const cases: [string, string | null, string][] = [
    ["Services", "Income", "revenue"],
    // Direct cost = consultancy, VPP, professional fees, staff salary.
    ["Salaries and Employee Wages", "Expense", "direct_cost"],
    ["Consultancy Charges", "Expense", "direct_cost"],
    ["Professional Fees", "Expense", "direct_cost"],
    ["Performance Incentive", "Expense", "direct_cost"],
    ["MCA expenses to be absorbed", "Expense", "direct_cost"],
    // Establishment = office rent, electricity, building maintenance.
    ["Rent Expense", "Expense", "establishment_cost"],
    ["Electricity Charges", "Expense", "establishment_cost"],
    ["Building  maintainance", "Expense", "establishment_cost"], // sic, double space
    // Everything else is an overhead.
    ["Staff Welfare", "Expense", "overheads"],
    ["Printing and Stationery", "Expense", "overheads"],
    ["Computer Maintanence", "Expense", "overheads"],
    ["Dues and Subscriptions", "Expense", "overheads"],
    // Both halves of a client recharge must land together so they net.
    ["RI expense reimbursment", "Other Expense", "reimbursements"],
    ["Reimbursement Income", "Other Income", "reimbursements"],
    ["Depreciation", "Expense", "depreciation"],
    ["Bank Fees and Charges", "Expense", "finance_cost"],
    ["Interest on Car loan MP", "Expense", "finance_cost"],
    ["Business Promotion", "Expense", "overheads"],
    ["HDFC Bank", "Bank", "cash"],
    ["Trade Receivables", "Accounts Receivable", "receivables"],
    ["Reserves & Surplus", "Equity", "reserves"],
    ["Office Equipment", "Fixed Asset", "fixed_assets"],
    ["Dimension Adjustments", "other_liability", "other_liab"],
  ];
  for (const [name, type, expected] of cases) {
    const guess = suggestMapping(name, type);
    check(`${name} -> ${expected}`, guess.groupCode === expected, `got ${guess.groupCode}`);
  }
}

/* ---------- account mapping with NO account-type column ---------- */
// A general ledger exported without account types must still keep balance-sheet
// accounts off the P&L. "Salaries Payable" netting against "Salaries & Wages"
// silently understated employee cost, which is exactly the failure to guard.
console.log("\n== Account mapping from name alone (no type column) ==");
{
  const cases: [string, "pnl" | "bs" | "none", string | null][] = [
    ["Salaries & Wages", "pnl", "direct_cost"],
    ["Salaries Payable", "bs", "payables"],
    ["Depreciation", "pnl", "depreciation"],
    ["Accumulated Depreciation", "bs", "fixed_assets"],
    ["Trade Receivables", "bs", "receivables"],
    ["Trade Payables", "bs", "payables"],
    ["Rent", "pnl", "establishment_cost"],
    ["Electricity Charges", "pnl", "establishment_cost"],
    ["Bank Charges", "pnl", "finance_cost"],
    ["Bank Fees and Charges", "pnl", "finance_cost"],
    ["HDFC Bank", "bs", "cash"],
    ["Filing Fees", "pnl", "direct_cost"],
    ["Consultancy Charges", "pnl", "direct_cost"],
    ["Performance Incentive", "pnl", "direct_cost"],
    ["Staff Welfare", "pnl", "overheads"],
    ["Reserves & Surplus", "bs", "reserves"],
    ["Share Capital", "bs", "equity"],
    ["Office Equipment", "bs", "fixed_assets"],
    ["Provision for Tax", "bs", "other_liab"],
    ["Prepaid Insurance", "bs", "other_ca"],
    ["TDS Receivable", "bs", "receivables"],
    ["Interest on Bank Loan", "pnl", "finance_cost"],
    ["RI expense reimbursment", "pnl", "reimbursements"],
    ["Partners Drawings", "pnl", "partner_drawings"],
  ];
  for (const [name, statement, expected] of cases) {
    const guess = suggestMapping(name, null);
    check(
      `${name} -> ${statement}/${expected}`,
      guess.statement === statement && guess.groupCode === expected,
      `got ${guess.statement}/${guess.groupCode}`,
    );
  }
}

console.log(
  failures === 0
    ? "\nAll parser checks passed.\n"
    : `\n${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);

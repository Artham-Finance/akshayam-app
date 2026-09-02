/**
 * Exercises the balance sheet's arithmetic against the ways it has actually
 * failed to tie. Run: node scripts/check-statements.mts
 *
 * No database and no fixtures: composeBalanceSheet takes the rows the queries
 * would have returned, so every case here is a few lines of hand-written
 * ledger. That is deliberate - each of these bugs was found on the client's
 * real data weeks after it was introduced, and each one is a difference of a
 * crore that no amount of reading the statement would have explained.
 *
 * The invariant under test is always the same: total assets plus total equity
 * and liabilities is zero, because the values carry their natural sign. If a
 * change makes any case here fail, the statement it produces is out by that
 * much on screen.
 */
import { composeBalanceSheet, type StatementResult } from "../src/lib/reports/compose";
import { buildDuPont } from "../src/lib/reports/dupont";
import {
  rateAgeingDays,
  rateBudgetAchievement,
  rateContributionShare,
  WEIGHTS,
} from "../src/lib/reports/scorecard-rating";
import { fyMonths } from "../src/lib/period";

const months = fyMonths(2026);
const first = months[0].key;
const last = months[months.length - 1].key;

let failures = 0;

function check(label: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`   ok   ${label}${detail ? ` (${detail})` : ""}`);
  } else {
    failures++;
    console.log(`   FAIL ${label}${detail ? ` (${detail})` : ""}`);
  }
}

/** The gap the page shows in its red banner, at the close of the year. */
function gapAt(result: StatementResult, month = last) {
  const assets = result.lines.find((l) => l.groupCode === "total_assets");
  const eqLiab = result.lines.find((l) => l.groupCode === "total_eq_liab");
  return (assets?.values[month] ?? 0) + (eqLiab?.values[month] ?? 0);
}

function ties(result: StatementResult) {
  return months.every((m) => Math.abs(gapAt(result, m.key)) < 0.005);
}

function has(result: StatementResult, key: string) {
  return result.lines.some((l) => l.key === key);
}

/** The seeded balance-sheet groups, in the order a company gets them. */
const groups = [
  { code: "fixed_assets", name: "Property, Plant & Equipment", sort_order: 10, is_subtotal: false, subtotal_of: null, sign: 1 },
  { code: "intangibles", name: "Intangible Assets", sort_order: 20, is_subtotal: false, subtotal_of: null, sign: 1 },
  { code: "investments", name: "Investments", sort_order: 30, is_subtotal: false, subtotal_of: null, sign: 1 },
  { code: "other_nca", name: "Other Non-Current Assets", sort_order: 40, is_subtotal: false, subtotal_of: null, sign: 1 },
  { code: "total_nca", name: "Total Non-Current Assets", sort_order: 50, is_subtotal: true, subtotal_of: ["fixed_assets", "intangibles", "investments", "other_nca"], sign: 1 },
  { code: "receivables", name: "Trade Receivables", sort_order: 60, is_subtotal: false, subtotal_of: null, sign: 1 },
  { code: "cash", name: "Cash & Bank Balances", sort_order: 70, is_subtotal: false, subtotal_of: null, sign: 1 },
  { code: "other_ca", name: "Other Current Assets", sort_order: 80, is_subtotal: false, subtotal_of: null, sign: 1 },
  { code: "total_ca", name: "Total Current Assets", sort_order: 90, is_subtotal: true, subtotal_of: ["receivables", "cash", "other_ca"], sign: 1 },
  { code: "total_assets", name: "TOTAL ASSETS", sort_order: 100, is_subtotal: true, subtotal_of: ["total_nca", "total_ca"], sign: 1 },
  { code: "equity", name: "Partners'/Share Capital", sort_order: 110, is_subtotal: false, subtotal_of: null, sign: -1 },
  { code: "reserves", name: "Reserves & Surplus", sort_order: 120, is_subtotal: false, subtotal_of: null, sign: -1 },
  { code: "borrowings", name: "Borrowings", sort_order: 130, is_subtotal: false, subtotal_of: null, sign: -1 },
  { code: "payables", name: "Trade Payables", sort_order: 140, is_subtotal: false, subtotal_of: null, sign: -1 },
  { code: "other_liab", name: "Other Liabilities & Provisions", sort_order: 150, is_subtotal: false, subtotal_of: null, sign: -1 },
  { code: "unclassified", name: "Unclassified", sort_order: 155, is_subtotal: false, subtotal_of: null, sign: -1 },
  { code: "total_eq_liab", name: "TOTAL EQUITY & LIABILITIES", sort_order: 160, is_subtotal: true, subtotal_of: ["equity", "reserves", "borrowings", "payables", "other_liab", "unclassified"], sign: -1 },
];

/** A balance, signed debit - credit, carried into the year. */
const open = (id: number, name: string, group: string | null, amount: number) => ({
  account_id: id, account_name: name, account_sort: id, group_code: group, amount,
});

/** A month's movement on one account, signed debit - credit. */
const move = (id: number, name: string, group: string | null, month: string, amount: number) => ({
  ...open(id, name, group, amount), month_key: month,
});

const base = { months, groups, consolidating: false, detail: true, interco: [], openingNonBs: [] };

/* ---------- a first year, with no opening position at all ---------- */
console.log("\n== First year: ledger movements, no opening balances ==");
{
  // The case that put RBJV's statement out by 1.42 crore. No opening balances
  // means no reserves account carries anything, and the profit line used to be
  // spliced under a Reserves heading that assemble() had dropped for being
  // empty - taking the whole year's result off the statement with it.
  const result = composeBalanceSheet({
    ...base,
    opening: [],
    movements: [
      move(1, "Accounts Receivable", "receivables", first, 1_400_000),
      move(2, "HDFC Current Account", "cash", first, 20_000),
    ],
    pnlMovements: [{ month_key: first, amount: 1_420_000 }],
  });

  check("statement ties in every month", ties(result), `gap ${gapAt(result).toFixed(2)}`);
  check("profit for the period is on the statement", has(result, "profit_for_period"));
  check(
    "reserves heading was created to carry it",
    result.lines.some((l) => l.groupCode === "reserves" && l.level === 0),
  );

  const order = result.lines.filter((l) => l.level === 0).map((l) => l.groupCode);
  check(
    "reserves sits between capital and the total it feeds",
    order.indexOf("reserves") > order.indexOf("total_assets") &&
      order.indexOf("reserves") < order.indexOf("total_eq_liab"),
    order.join(" > "),
  );
}

/* ---------- the ordinary case, opening balances loaded ---------- */
console.log("\n== Opening balances loaded, reserves already on the books ==");
{
  const result = composeBalanceSheet({
    ...base,
    opening: [
      open(2, "HDFC Current Account", "cash", 500_000),
      open(9, "Reserves & Surplus", "reserves", -500_000),
    ],
    movements: [move(2, "HDFC Current Account", "cash", first, 300_000)],
    pnlMovements: [{ month_key: first, amount: 300_000 }],
  });

  check("statement ties in every month", ties(result), `gap ${gapAt(result).toFixed(2)}`);
  check("profit for the period is on the statement", has(result, "profit_for_period"));
  check(
    "the reserves heading is not duplicated",
    result.lines.filter((l) => l.groupCode === "reserves" && l.level === 0).length === 1,
  );
}

/* ---------- prior-year income and expense in the opening position ---------- */
console.log("\n== Prior-year P&L balances carried in the trial balance ==");
{
  // A closing trial balance carries last year's income and expense accounts.
  // Ignored, they leave the opening balance sheet short by exactly their total
  // - this is the Rs 91,770 RBJV was out by. A general ledger spanning two
  // financial years carries the same thing as ledger movement.
  const result = composeBalanceSheet({
    ...base,
    opening: [open(2, "HDFC Current Account", "cash", 591_770)],
    movements: [],
    pnlMovements: [],
    openingNonBs: [{ statement: "pnl", amount: -591_770 }],
  });

  check("statement ties in every month", ties(result), `gap ${gapAt(result).toFixed(2)}`);
  check("prior-year balances are shown as brought forward", has(result, "brought_forward"));
}

/* ---------- an account nobody has mapped yet ---------- */
console.log("\n== Unmapped account ==");
{
  const result = composeBalanceSheet({
    ...base,
    opening: [],
    movements: [
      move(1, "Accounts Receivable", "receivables", first, 100_000),
      move(7, "Suspense", null, first, 25_000),
    ],
    pnlMovements: [{ month_key: first, amount: 125_000 }],
  });

  check("statement still ties", ties(result), `gap ${gapAt(result).toFixed(2)}`);
  check("the page is told to say so", result.hasUnmapped, `${result.unmappedTotal} unclassified`);
  check(
    "unmapped money is counted at the close, not summed month by month",
    Math.abs(result.unmappedTotal - 25_000) < 0.005,
    `${result.unmappedTotal}`,
  );
}

/* ---------- consolidation, where the two books disagree ---------- */
console.log("\n== Consolidation with an intercompany difference ==");
{
  // RBJV shows less owed to it than Akshayam shows owing. Both sides come out,
  // and what they disagree by is carried as its own line rather than smeared
  // across the statement or forced into reserves.
  const result = composeBalanceSheet({
    ...base,
    consolidating: true,
    opening: [],
    movements: [move(2, "HDFC Current Account", "cash", first, -100)],
    pnlMovements: [],
    interco: [
      { account_id: 47, month_key: first, amount: 1_000 },
      { account_id: 516, month_key: first, amount: -900 },
    ],
  });

  check("statement ties in every month", ties(result), `gap ${gapAt(result).toFixed(2)}`);
  check("the difference is carried on its own line", has(result, "intercompany_difference"));
  check(
    "and reported for the notice above the statement",
    Math.abs((result.eliminations?.difference ?? 0) - 100) < 0.005,
    `difference ${result.eliminations?.difference}`,
  );
}

/* ---------- nothing at all ---------- */
console.log("\n== Empty year ==");
{
  const result = composeBalanceSheet({ ...base, opening: [], movements: [], pnlMovements: [] });
  check("an empty statement ties rather than throwing", ties(result));
  check("and shows no profit line", !has(result, "profit_for_period"));
}

/* ---------- DuPont: the three factors must multiply back to RoE ---------- */
console.log("\n== DuPont decomposition ==");
{
  const mk = (groupCode: string, valueAt: (i: number) => number): StatementResult["lines"][number] => ({
    key: groupCode,
    name: groupCode,
    level: 0,
    isSubtotal: true,
    sign: 1,
    groupCode,
    accountId: null,
    values: Object.fromEntries(months.map((m, i) => [m.key, valueAt(i)])),
  });
  const stmt = (lines: StatementResult["lines"]): StatementResult => ({
    months,
    lines,
    hasUnmapped: false,
    unmappedTotal: 0,
  });

  // 5 months of ledger: Sales 100/mo for months 0-4 -> 500 ytd -> 1,200 annualised.
  // Net income 10/mo -> 50 ytd -> 120 annualised. Later months are nil, as a
  // real P&L has past the ledger cutoff.
  const pnl = stmt([
    mk("revenue", (i) => (i < 5 ? 100 : 0)),
    mk("pat", (i) => (i < 5 ? 10 : 0)),
  ]);
  // Balance sheet is a running position - the same closing balance every month
  // end: total_assets 400 (debit +), equity -150, reserves -50 (credit).
  const bs = stmt([
    mk("total_assets", () => 400),
    mk("equity", () => -150),
    mk("reserves", () => -50),
  ]);

  const d = buildDuPont({ pnl, bs, monthsElapsed: 5 });
  check("net income annualised", Math.abs(d.inputs.netIncome - 120) < 0.005, `${d.inputs.netIncome}`);
  check("sales annualised", Math.abs(d.inputs.sales - 1200) < 0.005, `${d.inputs.sales}`);
  check("total equity from credit balances", Math.abs(d.inputs.totalEquity - 200) < 0.005, `${d.inputs.totalEquity}`);
  check("net profit margin", Math.abs((d.ratios.netProfitMargin ?? 0) - 0.1) < 1e-9);
  check("asset turnover", Math.abs((d.ratios.assetTurnover ?? 0) - 3) < 1e-9);
  check("financial leverage", Math.abs((d.ratios.financialLeverage ?? 0) - 2) < 1e-9);
  const product =
    (d.ratios.netProfitMargin ?? 0) * (d.ratios.assetTurnover ?? 0) * (d.ratios.financialLeverage ?? 0);
  check(
    "RoE = margin x turnover x leverage = NI / equity",
    Math.abs(product - (d.ratios.returnOnEquity ?? 0)) < 1e-9 &&
      Math.abs((d.ratios.returnOnEquity ?? 0) - 120 / 200) < 1e-9,
    `${d.ratios.returnOnEquity}`,
  );
}

/* ---------- Scorecard rating bands ---------- */
console.log("\n== Scorecard rating bands ==");
{
  check("revenue achievement 100% -> 4", rateBudgetAchievement(1) === 4);
  check("revenue achievement 82% -> 3", rateBudgetAchievement(0.82) === 3);
  check("revenue achievement 75% -> 2", rateBudgetAchievement(0.75) === 2);
  check("revenue achievement 41% -> 1", rateBudgetAchievement(0.41) === 1);
  check("revenue achievement 30% -> 0", rateBudgetAchievement(0.3) === 0);
  check("revenue achievement no budget -> 0", rateBudgetAchievement(null) === 0);

  check("contribution 22% -> 4", rateContributionShare(0.22) === 4);
  check("contribution 18% -> 3", rateContributionShare(0.18) === 3);
  check("contribution 12% -> 2", rateContributionShare(0.12) === 2);
  check("contribution 6% -> 1", rateContributionShare(0.06) === 1);
  check("contribution 3% -> 0", rateContributionShare(0.03) === 0);
  check("contribution negative -> 0", rateContributionShare(-0.1) === 0);

  check("ageing 0 days (nothing outstanding) -> 4", rateAgeingDays(0) === 4);
  check("ageing 40 days -> 3", rateAgeingDays(40) === 3);
  check("ageing 50 days -> 2", rateAgeingDays(50) === 2);
  check("ageing 100 days -> 1", rateAgeingDays(100) === 1);
  check("ageing 200 days -> 0", rateAgeingDays(200) === 0);

  const w = WEIGHTS;
  check(
    "weights sum to 1",
    Math.abs(
      w.revenue + w.collection + w.netRevContrib + w.netCollContrib + w.ageing + w.mgmt - 1,
    ) < 1e-9,
  );
  // composite of straight 3s is 3
  const c = 3 * (w.revenue + w.collection + w.netRevContrib + w.netCollContrib + w.ageing + w.mgmt);
  check("composite of all-3 ratings is 3.0", Math.abs(c - 3) < 1e-9);
}

console.log(
  failures === 0
    ? "\nAll balance sheet cases tie.\n"
    : `\n${failures} case(s) FAILED - the statement would be out on screen.\n`,
);
process.exit(failures === 0 ? 0 : 1);

import type { StatementResult } from "@/lib/reports/compose";

/**
 * DuPont decomposition of Return on Equity.
 *
 *   RoE = Net Profit Margin  ×  Asset Turnover  ×  Financial Leverage
 *       = (NI / Sales)        ×  (Sales / Assets) ×  (Assets / Equity)
 *       = NI / Equity
 *
 * Sales and Net Income are the ledger's year-to-date figures scaled to a
 * full-year run-rate (× 12 / months elapsed), because the statement is read
 * mid-year and an un-annualised RoE reads as a collapse rather than a rate.
 * Assets and Equity are the period-end position - a point-in-time balance, not
 * an average, which is the firm's stated preference and keeps the figures
 * reconcilable to the balance sheet page.
 *
 * Pure: it takes the two StatementResults the page already builds and does
 * arithmetic on them, nothing else, so scripts/check-statements.mts can
 * exercise it without a database.
 */

export interface DuPontResult {
  applicable: boolean;
  monthsElapsed: number;
  annualiseFactor: number;
  inputs: {
    /** P&L Revenue from Operations, year to date */
    salesYtd: number;
    /** P&L Profit After Tax, year to date */
    netIncomeYtd: number;
    /** salesYtd × annualiseFactor */
    sales: number;
    /** netIncomeYtd × annualiseFactor */
    netIncome: number;
    /** Balance sheet Total Assets at the last month end */
    totalAssets: number;
    /** Partners'/Share Capital + Reserves & Surplus at the last month end */
    totalEquity: number;
  };
  ratios: {
    /** NI / Sales, a fraction */
    netProfitMargin: number | null;
    /** Sales / Assets, a multiple */
    assetTurnover: number | null;
    /** NI / Assets, a fraction */
    returnOnAssets: number | null;
    /** Assets / Equity, a multiple */
    financialLeverage: number | null;
    /** NI / Equity, a fraction */
    returnOnEquity: number | null;
  };
  notes: string[];
}

/** Sum one group's line across every month of the statement. */
function pnlTotal(result: StatementResult, groupCode: string): number {
  const line = result.lines.find((l) => l.groupCode === groupCode && l.level === 0);
  if (!line) return 0;
  return result.months.reduce((sum, m) => sum + (line.values[m.key] ?? 0), 0);
}

/** One group's balance at the last month end. */
function bsClosing(result: StatementResult, groupCode: string): number {
  const line = result.lines.find((l) => l.groupCode === groupCode && l.level === 0);
  if (!line || result.months.length === 0) return 0;
  const last = result.months[result.months.length - 1].key;
  return line.values[last] ?? 0;
}

export function buildDuPont(input: {
  pnl: StatementResult;
  bs: StatementResult;
  monthsElapsed: number;
}): DuPontResult {
  const { pnl, bs } = input;
  const monthsElapsed = Math.min(12, Math.max(0, Math.round(input.monthsElapsed)));
  const annualiseFactor = monthsElapsed > 0 ? 12 / monthsElapsed : 1;

  const salesYtd = pnlTotal(pnl, "revenue");
  const netIncomeYtd = pnlTotal(pnl, "pat");
  const sales = salesYtd * annualiseFactor;
  const netIncome = netIncomeYtd * annualiseFactor;

  const totalAssets = bsClosing(bs, "total_assets");
  // equity + reserves are credit balances, stored negative under debit - credit.
  const totalEquity = -(bsClosing(bs, "equity") + bsClosing(bs, "reserves"));

  const notes: string[] = [];
  const netProfitMargin = sales !== 0 ? netIncome / sales : null;
  const assetTurnover = totalAssets !== 0 ? sales / totalAssets : null;
  const returnOnAssets = totalAssets !== 0 ? netIncome / totalAssets : null;
  const financialLeverage = totalEquity > 0 ? totalAssets / totalEquity : null;
  const returnOnEquity = totalEquity > 0 ? netIncome / totalEquity : null;

  if (sales <= 0) notes.push("Revenue is nil or negative, so margin and turnover cannot be struck.");
  if (totalEquity <= 0) {
    notes.push(
      "Equity is nil or negative at the period end, so leverage and Return on Equity are left blank - the ratio has no meaning against a negative base.",
    );
  }
  if (monthsElapsed > 0 && monthsElapsed < 12) {
    notes.push(
      `Net Income and Sales are annualised from ${monthsElapsed} month${monthsElapsed === 1 ? "" : "s"} of ledger (× ${annualiseFactor.toFixed(2)}). Assets and Equity are the actual position at the period end.`,
    );
  }

  const applicable = sales > 0 && totalAssets !== 0 && totalEquity > 0;

  return {
    applicable,
    monthsElapsed,
    annualiseFactor,
    inputs: { salesYtd, netIncomeYtd, sales, netIncome, totalAssets, totalEquity },
    ratios: { netProfitMargin, assetTurnover, returnOnAssets, financialLeverage, returnOnEquity },
    notes,
  };
}

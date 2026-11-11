/**
 * The historical monthly P&L, and how a month of it is struck.
 *
 * Pure - no database, no file - so the upload's parser and the report that reads the rows
 * back agree on one definition of Revenue, Expenses and Profit before tax.
 */

export interface HistoricalPlMonth {
  /** "2024-03" */
  month: string;
  /** the sheet the month was read from */
  sheetName: string;
  revenue: number;
  expenses: number;
  otherNet: number;
  taxBooked: number;
  reportedNet: number | null;
  /** section -> account -> amount, as the sheet carried them */
  lines: Record<string, Record<string, number>>;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Operating-income accounts that are not fees: they sit with other income, as in the ledger. */
function isOtherIncomeAccount(name: string): boolean {
  return /^interest\b/i.test(name) || /^other income\b/i.test(name) || /^dividend/i.test(name);
}

/** The company's income-tax provision, booked inside operating expense in some months. */
function isIncomeTaxProvision(name: string): boolean {
  return /^provision for (income )?tax/i.test(name);
}

type Section = "operating_income" | "cogs" | "operating_expense" | "non_operating_income" | "non_operating_expense" | "oci";

export function sectionOf(heading: string): Section | null {
  const h = heading.trim().toLowerCase();
  if (h === "operating income") return "operating_income";
  if (h === "cost of goods sold") return "cogs";
  if (h === "operating expense" || h === "operating expenses") return "operating_expense";
  if (h === "non operating income" || h === "non-operating income") return "non_operating_income";
  if (h === "non operating expense" || h === "non-operating expense" || h === "non operating expenses") {
    return "non_operating_expense";
  }
  if (h === "other comprehensive income") return "oci";
  return null;
}

/**
 * Strike a month from the accounts of each section.
 *
 *   revenue    = operating income, except interest / other income
 *   expenses   = cost of goods sold + operating expense, except the income-tax provision
 *   other_net  = interest / other income + non-operating income - non-operating expense
 */
export function strikeMonth(sections: Record<string, Record<string, number>>): {
  revenue: number;
  expenses: number;
  otherNet: number;
  taxBooked: number;
  /** what the sheet's own bottom line should come to, to check against it */
  netProfit: number;
} {
  const sum = (s: Section, keep: (name: string) => boolean = () => true) =>
    Object.entries(sections[s] ?? {}).reduce((t, [name, v]) => (keep(name) ? t + v : t), 0);

  const operatingIncome = sum("operating_income");
  const otherIncome = sum("operating_income", isOtherIncomeAccount);
  const revenue = operatingIncome - otherIncome;

  const taxBooked = sum("operating_expense", isIncomeTaxProvision);
  const expenses = sum("cogs") + sum("operating_expense") - taxBooked;

  const nonOperating = sum("non_operating_income") - sum("non_operating_expense");
  const otherNet = otherIncome + nonOperating;

  const netProfit = operatingIncome - sum("cogs") - sum("operating_expense") + nonOperating;
  return {
    revenue: round2(revenue),
    expenses: round2(expenses),
    otherNet: round2(otherNet),
    taxBooked: round2(taxBooked),
    netProfit: round2(netProfit),
  };
}

export const profitBeforeTax = (f: { revenue: number; expenses: number; otherNet: number }) =>
  f.revenue - f.expenses + f.otherNet;

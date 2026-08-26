/**
 * How the budget spreads common cost, and what to call each basis.
 *
 * Kept apart from the report that applies it because the table that shows the
 * result is a client component - it has a figure-scale picker and a detail
 * toggle - and importing the report would pull the database driver into the
 * browser bundle. This module holds data and nothing else.
 */

export type Basis = "equal9" | "equal8" | "revenue" | "headsAll" | "headsExclGift";

export interface Rule {
  /** the budget's name for this head of cost */
  head: string;
  basis: Basis;
  /** matched against the account's reporting group, if given */
  group?: string;
  /** matched against the account name */
  name?: RegExp;
}

/**
 * First match wins, so the specific rules come before the catch-all. The heads
 * are the budget's, and the bases are the ones it used for them.
 */
export const RULES: Rule[] = [
  { head: "Office expenses", basis: "headsExclGift", group: "establishment_cost" },
  { head: "Staff welfare", basis: "headsExclGift", name: /welfare|pooja|team lunch/i },
  { head: "Accounting support", basis: "equal8", name: /accounting/i },
  { head: "Consultancy charges", basis: "revenue", name: /consultancy|consulting/i },
  { head: "Referral fee", basis: "revenue", name: /referral/i },
  { head: "Communication", basis: "headsAll", name: /telephone|internet|communication|mobile|postage|courier/i },
  { head: "Travelling & conveyance", basis: "equal9", name: /travel|conveyance|petrol|cab\b/i },
  { head: "Donation", basis: "equal9", name: /donation/i },
  { head: "Common salaries & VPP", basis: "equal9", group: "direct_cost" },
  { head: "Other expenses", basis: "headsAll" },
];

export const BASIS_LABEL: Record<Basis, string> = {
  equal9: "equal, 9 verticals",
  equal8: "equal, 8 (excl Gift)",
  revenue: "revenue ratio",
  headsAll: "head count, all 9",
  headsExclGift: "head count (excl Gift)",
};

export const HEAD_BASIS: Record<string, Basis> = Object.fromEntries(
  RULES.map((r) => [r.head, r.basis]),
);

/**
 * TDS corrections: one-off changes the client asks for, kept in a hand-maintained sheet and
 * uploaded (see the "TDS Corrections" upload). Today the one kind is moving a customer's
 * TDS from one vertical to another; each is a row of customer, vertical it is moved from and
 * vertical it is moved to, optionally the year it is for.
 *
 * Free of any database import, so the upload, the report and the screen read the same rules.
 */

/** A correction as stored: the customer, and the verticals by id. `fy` null means every year. */
export interface TdsCorrection {
  customer: string;
  fromVerticalId: number;
  toVerticalId: number;
  /** "FY24-25", or null for every year the customer is held under the from-vertical */
  fy: string | null;
}

const LEGAL_WORDS = new Set(["private", "pvt", "limited", "ltd", "llp", "inc", "incorporated", "co", "company"]);

/**
 * A customer's name as it is compared: the sheet says "Tidel Neo", the books say
 * "Tidel Neo Limited"; "Kripya Technologies (India) Private Limited" and the same in capitals
 * are one customer. Case, punctuation, "&"/"and" and the legal ending are ignored.
 */
export function normaliseCustomer(name: string): string {
  const words = String(name ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);
  // The legal ending only - never a word the name begins with, so "Private Equity Fund" survives.
  while (words.length > 1 && LEGAL_WORDS.has(words[words.length - 1])) words.pop();
  return words.join(" ");
}

/** "FY24-25", "fy 2024-25", "2024-25" and "24-25" all read as "FY24-25"; anything else is null. */
export function normaliseFy(text: string | null | undefined): string | null {
  const m = String(text ?? "")
    .toLowerCase()
    .match(/(?:fy)?\s*(?:20)?(\d{2})\s*[-/–]\s*(?:20)?(\d{2})/);
  if (!m) return null;
  return `FY${m[1]}-${m[2]}`;
}

/**
 * The vertical a row of the TDS sheet belongs to once the corrections are applied, in the
 * order they were written: a customer moved from GADD to ECM and then from ECM to RRG ends
 * in RRG. A correction acts only on a customer held under the vertical it moves from (so a
 * row already moved, or never there, is left alone) and, when it names a year, only that year.
 */
export function applyCorrections(
  row: { customer: string; verticalId: number; fy: string },
  corrections: TdsCorrection[],
): { verticalId: number; movedFrom: number | null } {
  const key = normaliseCustomer(row.customer);
  let verticalId = row.verticalId;
  for (const c of corrections) {
    if (c.fromVerticalId !== verticalId) continue;
    if (c.fy !== null && c.fy !== row.fy) continue;
    if (normaliseCustomer(c.customer) !== key) continue;
    verticalId = c.toVerticalId;
  }
  return { verticalId, movedFrom: verticalId === row.verticalId ? null : row.verticalId };
}

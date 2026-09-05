/**
 * Matching a Form 26AS deductor to a customer in the sales ledger.
 *
 * The two names come from different places and are written differently:
 *
 *   26AS   RAM NATH AND CO PRIVATE LIMITED     (from the deductor's TDS return)
 *   Zoho   Ram Nath & Co Pvt Ltd               (however the firm typed it)
 *
 * Normalising case, punctuation, "&" and the corporate suffix makes most of
 * them the same string. What it deliberately does not do is fuzzy matching:
 * "ADANI GREEN ENERGY LIMITED" and "ADANI TRANSMISSION STEP-ONE LIMITED" are
 * different customers, and a similarity score close enough to join those would
 * be close enough to join others that must stay apart. Anything not matched
 * exactly is reported as unmatched, where it can be mapped by hand once.
 */

/** Corporate form words, which carry no identity and are written every which way. */
const SUFFIX_WORDS = new Set([
  "PRIVATE", "PVT", "LIMITED", "LTD", "LLP", "LLC", "INC", "CORPORATION", "CORP",
  "COMPANY", "PUBLIC", "PLC",
]);

/**
 * Case, punctuation and spacing removed; "&" spelled out.
 * "M/s. Ram-Nath & Co." -> "MS RAM NATH AND CO"
 *
 * A trailing " in BO" / " in HO" is Zoho's branch marker on the customer
 * record - "Anicut Capital LLP in BO" is the same customer as "Anicut Capital
 * LLP" - so it is dropped. Only those two are stripped: one RBJV customer is
 * genuinely named "... in Liquidation", and that is part of its name.
 */
const BRANCH_SUFFIX = /\s+IN\s+(BO|HO)$/;

export function normaliseParty(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(BRANCH_SUFFIX, "");
}

/**
 * The identifying part of the name, with corporate-form words removed from the
 * tail. "RAM NATH AND CO PRIVATE LIMITED" -> "RAM NATH AND CO".
 *
 * Only trailing words are stripped: "LIMITED LIABILITY PARTNERSHIP SERVICES"
 * as an actual trading name keeps its words, and a one-word company called
 * "Limited" would not be reduced to nothing.
 */
export function partyCore(raw: string): string {
  const words = normaliseParty(raw).split(" ").filter(Boolean);
  while (words.length > 1 && SUFFIX_WORDS.has(words[words.length - 1])) words.pop();
  return words.join(" ");
}

export type MatchBasis = "exact" | "core" | "alias" | "unmatched";

export interface PartyMatch {
  customerName: string | null;
  basis: MatchBasis;
}

/**
 * Build a matcher over the known customer names.
 *
 * A core form shared by two different customers is not usable - joining on it
 * would pick one arbitrarily - so those are dropped from the core index and
 * fall through to unmatched.
 */
export function buildPartyMatcher(
  customers: string[],
  aliases: Map<string, string> = new Map(),
) {
  const byExact = new Map<string, string>();
  const coreCounts = new Map<string, Set<string>>();

  for (const name of customers) {
    byExact.set(normaliseParty(name), name);
    const core = partyCore(name);
    if (!coreCounts.has(core)) coreCounts.set(core, new Set());
    coreCounts.get(core)!.add(name);
  }

  const byCore = new Map<string, string>();
  for (const [core, names] of coreCounts) {
    if (names.size === 1 && core) byCore.set(core, [...names][0]);
  }

  return function match(deductorName: string): PartyMatch {
    const key = normaliseParty(deductorName);

    const alias = aliases.get(key);
    if (alias) return { customerName: alias, basis: "alias" };

    const exact = byExact.get(key);
    if (exact) return { customerName: exact, basis: "exact" };

    const core = byCore.get(partyCore(deductorName));
    if (core) return { customerName: core, basis: "core" };

    return { customerName: null, basis: "unmatched" };
  };
}

import { query } from "@/lib/db";
import type { Entity } from "@/lib/entity";
import { normaliseRiRef } from "@/lib/parse/reimbursement-bills";

/**
 * RE / RI reconciliation.
 *
 * RE (a reimbursable expense, booked as a bill against a client cost - almost
 * always a credit-card statement line) is only ever visible at the RI number
 * a person typed into that bill line's own description; nothing structural
 * ties the two together. RI (the invoice recovering it) is already a clean,
 * numbered posting in the ledger - "Reimbursement Income", txn_type
 * 'invoice', its own txn_number.
 *
 * So the match is by that one shared reference, normalised (upper-cased,
 * punctuation stripped) so "RI-2627-0008" and "RI 2627 0008" are the same
 * key, and matched separately within each entity - RBJV's RI-2627-0008 is
 * not Akshayam's. A credit note against an already-raised RI (its own
 * txn_number starts "RICN") is not a fresh RI raised, so it is left out of
 * the RI side entirely rather than read as a second, contradictory invoice.
 *
 * One RE line can name more than one RI ("CDSL- RI-2627-0013, RI-2627-0042"
 * is a real one) and is shown once per reference it matches; an RI matched by
 * more than one RE line is shown against each of them, since two people
 * billing the same client cost is exactly the kind of thing this view exists
 * to surface, not hide.
 *
 * "RI not raised" is not one thing. An RE line can fail to match for three
 * different reasons, and only one of them is actually "go raise the RI":
 *
 *   - no RI number was typed on the line at all - a data-entry gap, not a
 *     billing gap;
 *   - the number names a *different* financial year than the one being
 *     reconciled (its own "RI-2526-..." vs this year's "RI-2627-..."), which
 *     this app cannot verify without that year's ledger loaded;
 *   - the number is for this year and genuinely is not on the ledger - the
 *     one case that is actually an outstanding RI to raise.
 *
 * Lumping all three together buries the real worklist under noise this tool
 * cannot resolve on its own, so they are split by the reference's own FY code
 * rather than left for a reader to triage by eye.
 */

export interface RecoRow {
  status: "matched" | "re_needs_ri" | "re_not_tagged" | "re_prior_year" | "ri_only";
  entityName: string;
  riRef: string | null;
  reDate: string | null;
  reAmount: number | null;
  reVendor: string | null;
  reCustomer: string | null;
  reDescription: string | null;
  riDate: string | null;
  riAmount: number | null;
  riCustomer: string | null;
}

export interface ReimbursementRecoResult {
  matched: RecoRow[];
  /** has a reference for this financial year, but no matching RI was found - the real worklist */
  reNeedsRi: RecoRow[];
  /** no RI number was typed on the line at all */
  reNotTagged: RecoRow[];
  /** names a reference from a different financial year - unverifiable without that year's ledger */
  rePriorYear: RecoRow[];
  riOnly: RecoRow[];
  totals: {
    matchedCount: number;
    matchedAmount: number;
    reNeedsRiCount: number;
    reNeedsRiAmount: number;
    reNotTaggedCount: number;
    reNotTaggedAmount: number;
    rePriorYearCount: number;
    rePriorYearAmount: number;
    riOnlyCount: number;
    riOnlyAmount: number;
  };
}

/** "RI-2627-0038" / "RI-AKS-2627-0008" -> "2627"; null when the shape is not recognised. */
function fyCodeOf(ref: string): string | null {
  const m = /^RI-(?:AKS-)?(\d{4})-/i.exec(ref);
  return m ? m[1] : null;
}

/** fyStartYear 2026 -> "2627", the code Zoho's own RI numbering uses for that year. */
function currentFyCode(fyStartYear: number): string {
  return `${String(fyStartYear).slice(-2)}${String(fyStartYear + 1).slice(-2)}`;
}

interface ReRow {
  entity_id: number;
  entity_name: string;
  bill_date: string;
  vendor_name: string | null;
  bill_number: string | null;
  description: string | null;
  customer_name: string | null;
  amount: string;
  ri_references: string[];
}

interface RiRow {
  entity_id: number;
  entity_name: string;
  txn_date: string;
  txn_number: string | null;
  description: string | null;
  amount: string;
}

export async function buildReimbursementReco(opts: {
  entity: Entity;
  start: string;
  end: string;
  fyStartYear: number;
}): Promise<ReimbursementRecoResult> {
  const { entity, start, end, fyStartYear } = opts;
  const thisFyCode = currentFyCode(fyStartYear);

  const [reRows, riRows] = await Promise.all([
    query<ReRow>(
      `select r.entity_id, e.name as entity_name, to_char(r.bill_date, 'YYYY-MM-DD') as bill_date,
              r.vendor_name, r.bill_number, r.description, r.customer_name, r.amount, r.ri_references
         from reimbursement_bill_lines r
         join entities e on e.id = r.entity_id
        where r.entity_id = any($1::int[]) and r.bill_date between $2 and $3
        order by r.bill_date`,
      [entity.memberIds, start, end],
    ),
    query<RiRow>(
      `select g.entity_id, e.name as entity_name, to_char(g.txn_date, 'YYYY-MM-DD') as txn_date,
              g.txn_number, g.description, g.credit as amount
         from gl_entries g
         join accounts a on a.id = g.account_id
         join entities e on e.id = g.entity_id
        where g.entity_id = any($1::int[]) and g.txn_date between $2 and $3
          and a.group_code = 'reimbursements' and a.name ilike '%income%' and g.txn_type = 'invoice'
        order by g.txn_date`,
      [entity.memberIds, start, end],
    ),
  ]);

  interface RiEntry {
    entityId: number;
    entityName: string;
    date: string;
    txnNumber: string;
    amount: number;
    customer: string | null;
    matched: boolean;
  }
  const riPool = new Map<string, RiEntry>();

  for (const r of riRows) {
    const raw = (r.txn_number ?? "").trim();
    // A credit note against an RI already raised - not a second RI to match.
    if (!raw || /^RICN/i.test(raw)) continue;
    let normalised = raw.toUpperCase();
    // A handful of income postings drop the "RI-" prefix on the way out of
    // Zoho; recovered here, before the punctuation strip, so it still lines
    // up with a properly-prefixed reference on the RE side.
    if (/^\d{3,4}-\d{3,4}$/.test(normalised)) normalised = `RI-${normalised}`;
    const key = `${r.entity_id}|${normaliseRiRef(normalised)}`;
    riPool.set(key, {
      entityId: r.entity_id,
      entityName: r.entity_name,
      date: r.txn_date,
      txnNumber: raw,
      amount: Number(r.amount),
      customer: r.description,
      matched: false,
    });
  }

  const matched: RecoRow[] = [];
  const reNeedsRi: RecoRow[] = [];
  const reNotTagged: RecoRow[] = [];
  const rePriorYear: RecoRow[] = [];

  for (const re of reRows) {
    const refs = re.ri_references ?? [];
    let anyMatched = false;

    for (const ref of refs) {
      const ri = riPool.get(`${re.entity_id}|${normaliseRiRef(ref)}`);
      if (!ri) continue;
      ri.matched = true;
      anyMatched = true;
      matched.push({
        status: "matched",
        entityName: re.entity_name,
        riRef: ri.txnNumber,
        reDate: re.bill_date,
        reAmount: Number(re.amount),
        reVendor: re.vendor_name,
        reCustomer: re.customer_name,
        reDescription: re.description,
        riDate: ri.date,
        riAmount: ri.amount,
        riCustomer: ri.customer,
      });
    }

    if (anyMatched) continue;

    const row: RecoRow = {
      status: "re_needs_ri",
      entityName: re.entity_name,
      riRef: refs.length > 0 ? refs.join(", ") : null,
      reDate: re.bill_date,
      reAmount: Number(re.amount),
      reVendor: re.vendor_name,
      reCustomer: re.customer_name,
      reDescription: re.description,
      riDate: null,
      riAmount: null,
      riCustomer: null,
    };

    if (refs.length === 0) {
      reNotTagged.push({ ...row, status: "re_not_tagged" });
    } else if (refs.every((ref) => fyCodeOf(ref) !== null && fyCodeOf(ref) !== thisFyCode)) {
      // Every reference on the line names a different year - none of them
      // could possibly be found in this year's ledger, so this is a "cannot
      // verify" case, not a "still outstanding" one.
      rePriorYear.push({ ...row, status: "re_prior_year" });
    } else {
      reNeedsRi.push(row);
    }
  }

  const riOnly: RecoRow[] = [...riPool.values()]
    .filter((r) => !r.matched)
    .map((r) => ({
      status: "ri_only",
      entityName: r.entityName,
      riRef: r.txnNumber,
      reDate: null,
      reAmount: null,
      reVendor: null,
      reCustomer: null,
      reDescription: null,
      riDate: r.date,
      riAmount: r.amount,
      riCustomer: r.customer,
    }));

  const sum = (rows: RecoRow[], pick: (r: RecoRow) => number | null) =>
    rows.reduce((s, r) => s + (pick(r) ?? 0), 0);

  return {
    matched,
    reNeedsRi,
    reNotTagged,
    rePriorYear,
    riOnly,
    totals: {
      matchedCount: matched.length,
      matchedAmount: sum(matched, (r) => r.reAmount),
      reNeedsRiCount: reNeedsRi.length,
      reNeedsRiAmount: sum(reNeedsRi, (r) => r.reAmount),
      reNotTaggedCount: reNotTagged.length,
      reNotTaggedAmount: sum(reNotTagged, (r) => r.reAmount),
      rePriorYearCount: rePriorYear.length,
      rePriorYearAmount: sum(rePriorYear, (r) => r.reAmount),
      riOnlyCount: riOnly.length,
      riOnlyAmount: sum(riOnly, (r) => r.riAmount),
    },
  };
}

/** Whether any reimbursement bill line has ever been loaded for this entity. */
export async function hasReimbursementBillLines(memberIds: number[]): Promise<boolean> {
  const row = await query<{ exists: boolean }>(
    "select exists(select 1 from reimbursement_bill_lines where entity_id = any($1::int[])) as exists",
    [memberIds],
  );
  return row[0]?.exists ?? false;
}

import { query } from "@/lib/db";
import { verticalScope, type Entity } from "@/lib/entity";

/**
 * A receipt parked against the "Unadjusted Credit(s)" ledger account rather
 * than tied to an invoice - money the customer has paid that the books have
 * not yet matched to any bill. Read straight off the account name so it needs
 * no dedicated group_code and no reclassification of existing postings.
 */
export const UNADJUSTED_CREDIT_ACCOUNT = "a.name ~* 'unadjusted\\s*credits?'";

export interface UnadjustedCreditPosting {
  id: number;
  txnDate: string;
  txnNumber: string | null;
  reference: string | null;
  debit: number;
  credit: number;
  amount: number;
}

export interface UnadjustedCreditParty {
  party: string;
  total: number;
  postings: UnadjustedCreditPosting[];
}

export interface UnadjustedCreditDetail {
  parties: UnadjustedCreditParty[];
  total: number;
}

/**
 * Every posting behind the "Unadjusted credit" card, grouped by the party the
 * ledger's own description names.
 *
 * These are receipt journals, and the customer they were received from is not
 * filled in as a contact on any of them - the description is, and mostly
 * reads as the customer's name (the exceptions, a bank transfer or a suspense
 * entry, are exactly the postings worth a second look rather than ones to
 * paper over).
 *
 * One definition, used for the card's headline, its on-screen expand table
 * and its Excel export alike - so a download can never disagree with the
 * screen it was downloaded from.
 */
export async function buildUnadjustedCreditDetail(opts: {
  entity: Entity;
  /** cumulative to this date - the ledger has no snapshot concept */
  asOf: string;
  verticalId: number | null;
}): Promise<UnadjustedCreditDetail> {
  const { entity, asOf, verticalId } = opts;

  const rows = await query<{
    id: number;
    txn_date: string;
    txn_number: string | null;
    reference: string | null;
    debit: number;
    credit: number;
    party: string;
  }>(
    `select g.id, g.txn_date::text, g.txn_number, g.reference, g.debit, g.credit,
            coalesce(nullif(g.description, ''), '(no description on the entry)') as party
       from gl_entries g
       join accounts a on a.id = g.account_id
      where g.entity_id = any($1::int[])
        and g.txn_date <= $2
        and ${UNADJUSTED_CREDIT_ACCOUNT}
        and ($3::int is null or g.vertical_id = $3)
        ${verticalScope("$4", "g.vertical_id")}
      order by g.txn_date desc, g.id desc`,
    [entity.memberIds, asOf, verticalId, entity.verticalIds],
  );

  const byParty = new Map<string, UnadjustedCreditParty>();
  for (const r of rows) {
    const amount = Number(r.credit) - Number(r.debit);
    const found = byParty.get(r.party) ?? { party: r.party, total: 0, postings: [] };
    found.total += amount;
    found.postings.push({
      id: r.id,
      txnDate: r.txn_date,
      txnNumber: r.txn_number,
      reference: r.reference,
      debit: Number(r.debit),
      credit: Number(r.credit),
      amount,
    });
    byParty.set(r.party, found);
  }

  // A party netting to zero or into a debit balance is not unadjusted credit
  // - a debit balance means the party owes money, which belongs in
  // Receivables, not here, and showing it as a negative row under a card
  // titled "unadjusted credit" would read as this book netting itself down.
  const parties = [...byParty.values()]
    .filter((p) => p.total > 0)
    .sort((a, b) => b.total - a.total);

  return { parties, total: parties.reduce((s, p) => s + p.total, 0) };
}

import { query } from "@/lib/db";
import { verticalScope, type Entity } from "@/lib/entity";

/**
 * The individual ledger postings behind a statement's own account rows -
 * "what is this ₹65,000 actually made of". The statement itself only ever
 * carries month-summed figures (assemble(), compose.ts), so this is a
 * second, unaggregated read of the same accounts and window, kept separate
 * rather than threaded through assemble() so Balance Sheet and Cash Flow -
 * which also read that function, and can carry far more accounts - are not
 * paying for postings nobody asked to see.
 */

export interface StatementEntry {
  date: string;
  particulars: string;
  reference: string;
  amount: number;
}

/** One account's postings, keyed by the same account_id the statement's own lines carry. */
export async function buildAccountEntries(opts: {
  entity: Entity;
  accountIds: number[];
  start: string;
  end: string;
  verticalId?: number | null;
}): Promise<Map<number, StatementEntry[]>> {
  const { entity, accountIds, start, end, verticalId = null } = opts;
  const byAccount = new Map<number, StatementEntry[]>();
  if (accountIds.length === 0) return byAccount;

  const rows = await query<{
    account_id: number;
    txn_date: string;
    description: string | null;
    reference: string | null;
    txn_type: string | null;
    contact_name: string | null;
    amount: number;
  }>(
    `select g.account_id, to_char(g.txn_date, 'YYYY-MM-DD') as txn_date,
            nullif(btrim(g.description), '') as description,
            nullif(btrim(g.reference), '') as reference,
            g.txn_type, nullif(btrim(g.contact_name), '') as contact_name,
            (g.debit - g.credit) as amount
       from gl_entries g
       join accounts a on a.id = g.account_id
      where g.entity_id = any($1::int[]) and g.account_id = any($2::int[])
        and g.txn_date between $3 and $4
        and not ($5::boolean and a.is_intercompany)
        and ($6::int is null or g.vertical_id = $6)
        ${verticalScope("$7", "g.vertical_id")}
      order by g.txn_date desc, g.id desc`,
    [entity.memberIds, accountIds, start, end, entity.consolidates, verticalId, entity.verticalIds],
  );

  for (const r of rows) {
    const list = byAccount.get(r.account_id) ?? [];
    list.push({
      date: r.txn_date,
      particulars: r.contact_name ?? r.description ?? r.txn_type ?? "—",
      reference: r.reference ?? "",
      amount: Number(r.amount),
    });
    byAccount.set(r.account_id, list);
  }
  return byAccount;
}

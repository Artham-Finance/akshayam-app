import { listAllEntities, type Entity } from "@/lib/entity";

/**
 * Neither company passes a tax entry through the ledger. These rates exist
 * only so Profit Before Tax / Profit After Tax and the balance sheet's
 * reserves-vs-provision split can be shown as if one had been booked -
 * illustrative for the statement, not a filed computation. Keyed by slug
 * because the rate is company law, not something a vertical slice can
 * average: Raja's slice does not appear here, so its statements are
 * unaffected. The group is not keyed by a rate of its own - India does not
 * consolidate tax filing, so its statements sum its members' own tax instead
 * (see taxedMembers below).
 */
export const PRESENTATIONAL_TAX_RATE: Record<string, number> = {
  rbjv: 35,
  akshayam: 25,
};

export const PRESENTATIONAL_TAX_LABEL: Record<string, string> = {
  rbjv: "RBJV",
  akshayam: "Akshayam",
};

/**
 * The group's own members that have a presentational tax rate of their own.
 *
 * Raja is also `isGroup` by that flag's own definition - it reports on other
 * entities' ledgers rather than one of its own - but it is a slice
 * (`verticalIds` is set), not the whole of either company, so it is excluded
 * here exactly as a single-vertical filter is on the P&L: two verticals' cut
 * of Profit Before Tax is not a taxable base either company actually files
 * against.
 */
export async function taxedMembers(entity: Entity): Promise<Entity[]> {
  if (!entity.isGroup || entity.verticalIds !== null) return [];
  const all = await listAllEntities();
  return all.filter((m) => entity.memberIds.includes(m.id) && PRESENTATIONAL_TAX_RATE[m.slug]);
}

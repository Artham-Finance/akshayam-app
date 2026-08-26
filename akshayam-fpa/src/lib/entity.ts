import { cookies } from "next/headers";
import { query, queryOne } from "@/lib/db";

/**
 * Entity resolution.
 *
 * Three things can be selected: RBJV & Associates, Akshayam Corporate Advisors
 * Private Limited, and the group that consolidates them. The active one is
 * held in a cookie so every page picks it up without threading a parameter
 * through each one.
 *
 * The group is an entity like any other, distinguished only by having members.
 * Every report therefore reads `memberIds` - one company for a company, both
 * for the group - and filters on `entity_id = any(...)`. No page needs to know
 * which case it is looking at, and adding a third company would need no code.
 */

export interface Entity {
  id: number;
  slug: string;
  name: string;
  currency: string;
  fy_start_month: number;
  /** The entities whose books this one reports on: itself, or its members. */
  memberIds: number[];
  /**
   * Verticals this entity is limited to, or null for everything its members
   * have. Vertical ids are unique across companies, so one array expresses a
   * slice like "RBJV's AIF plus all of Akshayam" on its own.
   */
  verticalIds: number[] | null;
  /** True when this reports on other entities rather than a ledger of its own. */
  isGroup: boolean;
  /**
   * True only for a consolidation, where intercompany balances must be
   * eliminated. A slice is not the whole of anything, so nothing nets against
   * it and eliminating would only remove real balances.
   */
  consolidates: boolean;
}

export interface Vertical {
  id: number;
  code: string;
  name: string;
  sort_order: number;
  is_active: boolean;
  needs_review: boolean;
}

export const ENTITY_COOKIE = "fpa_entity";

interface EntityRow {
  id: number;
  slug: string;
  name: string;
  currency: string;
  fy_start_month: number;
  consolidates: boolean;
  member_ids: number[] | null;
  vertical_ids: number[] | null;
  /** how many member rows name no vertical, i.e. cover a whole company */
  whole_members: number;
}

/**
 * Every entity, each already carrying the ids it reports on.
 *
 * A single query rather than one per entity: the member list is small and
 * needed on every page, and a second round trip to build it would be pure
 * ceremony.
 */
const ENTITY_SELECT = `
  with resolved as (
    select e.id, e.slug, e.name, e.currency, e.fy_start_month, e.consolidates,
           array_remove(array_agg(distinct m.member_entity_id), null) as member_ids,
           array_remove(array_agg(distinct m.vertical_id), null) as vertical_ids,
           count(*) filter (where m.id is not null and m.vertical_id is null)::int as whole_members
      from entities e
      left join entity_members m on m.entity_id = e.id
     group by e.id
  )
  select * from resolved`;

function hydrate(row: EntityRow): Entity {
  const members = row.member_ids ?? [];
  const verticals = row.vertical_ids ?? [];
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    currency: row.currency,
    fy_start_month: row.fy_start_month,
    isGroup: members.length > 0,
    consolidates: row.consolidates,
    memberIds: members.length > 0 ? members : [row.id],
    // A vertical limit only applies when *every* member row names one. A
    // mixture would mean part of the entity is a slice and part is not, which
    // no single filter can express - so it reports on everything instead of
    // quietly dropping the whole-company half.
    verticalIds: verticals.length > 0 && row.whole_members === 0 ? verticals : null,
  };
}

export async function listEntities(): Promise<Entity[]> {
  const rows = await query<EntityRow>(`${ENTITY_SELECT} order by id`);
  return rows.map(hydrate);
}

/** The slug requested by the cookie, when we are inside a request. */
async function slugFromCookie(): Promise<string | null> {
  try {
    const store = await cookies();
    return store.get(ENTITY_COOKIE)?.value ?? null;
  } catch {
    // Called outside a request scope (scripts, build-time). Fall through.
    return null;
  }
}

export async function getEntity(slug?: string): Promise<Entity> {
  const wanted = slug ?? (await slugFromCookie());

  if (wanted) {
    const match = await queryOne<EntityRow>(`${ENTITY_SELECT} where slug = $1`, [wanted]);
    if (match) return hydrate(match);
  }

  const first = await queryOne<EntityRow>(`${ENTITY_SELECT} order by id limit 1`);
  if (!first) {
    throw new Error(
      'No companies are set up. Run "npm run db:migrate" to create the schema and seed data.',
    );
  }
  return hydrate(first);
}

/**
 * Verticals available to filter on.
 *
 * Empty for the group. Reporting tags are per-company and the two companies do
 * not share a scheme - RBJV tags CFC, CMRGA, GADD; Akshayam tags GIFT, LEGAL,
 * REGULATORY - so a consolidated vertical filter would silently return one
 * company's figures under a heading that reads like the group's. The group P&L
 * says so on screen rather than offering a picker that cannot mean anything
 * until the client maps the two schemes onto each other.
 */
export async function getVerticals(entity: Entity): Promise<Vertical[]> {
  // A slice already *is* a set of verticals, so its picker lists exactly those
  // - RAJA can be read as GIFT alone or AIF alone, which is the whole point of
  // giving one partner's book its own entity.
  if (entity.verticalIds) {
    return query<Vertical>(
      `select id, code, name, sort_order, is_active, needs_review
         from verticals where id = any($1::int[]) order by sort_order, name`,
      [entity.verticalIds],
    );
  }
  if (entity.isGroup) return [];
  return query<Vertical>(
    `select id, code, name, sort_order, is_active, needs_review
       from verticals
      where entity_id = $1 and is_active
      order by sort_order, name`,
    [entity.id],
  );
}

/**
 * The predicate limiting rows to an entity's verticals, for a query that has
 * already filtered on entity_id.
 *
 * Written to take the array as a parameter and no-op on null, so every query
 * carries the same clause and the same extra argument whether or not the
 * entity is a slice. A clause that appeared only sometimes would mean two
 * shapes of every query, and one of them would eventually be forgotten.
 */
export function verticalScope(param: string, column = "vertical_id"): string {
  return `and (${param}::int[] is null or ${column} = any(${param}::int[]))`;
}

/** Financial years that actually have ledger data, newest first. */
export async function getAvailableFinancialYears(entityIds: number[]): Promise<number[]> {
  const rows = await query<{ fy: number }>(
    `select distinct
            case when extract(month from txn_date) >= 4
                 then extract(year from txn_date)
                 else extract(year from txn_date) - 1
            end::int as fy
       from gl_entries
      where entity_id = any($1::int[])
      order by fy desc`,
    [entityIds],
  );
  return rows.map((r) => r.fy);
}

/** Accounts with postings whose reporting line was guessed, not confirmed. */
export async function countUnmappedAccounts(entityIds: number[]): Promise<number> {
  const row = await queryOne<{ count: number }>(
    `select count(*)::int as count
       from accounts a
      where a.entity_id = any($1::int[])
        and a.is_mapped = false
        and exists (select 1 from gl_entries g where g.account_id = a.id)`,
    [entityIds],
  );
  return row?.count ?? 0;
}

/** Verticals invented from an unrecognised tag, with how much sits in each. */
export async function getVerticalsNeedingReview(entityId: number) {
  return query<{ id: number; code: string; name: string; rows: number }>(
    `select v.id, v.code, v.name, count(g.id)::int as rows
       from verticals v
       left join gl_entries g on g.vertical_id = v.id
      where v.entity_id = $1 and v.needs_review
      group by v.id, v.code, v.name
      order by rows desc`,
    [entityId],
  );
}

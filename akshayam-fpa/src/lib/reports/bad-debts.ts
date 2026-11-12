import { query, queryOne } from "@/lib/db";
import { verticalScope, type Entity } from "@/lib/entity";

/**
 * Bad debts written off, from the list the accountant uploads (Upload → Bad debts written off) -
 * for RBJV and for Akshayam, each on its own view. The general ledger carries no customer, so it is
 * the list, not the ledger, that is read.
 *
 * Read for the Receivables page - a card, and the list behind it, of what was written off over a
 * window - and for the Collections page's Actual card, which carries a note of what was written off
 * for the vertical over the same window as the Actual. A vertical's head sees only the write-offs of
 * that vertical; a row with no vertical (Akshayam's sheet has none) belongs to the company as a
 * whole and shows on the company view.
 */

export interface BadDebtLine {
  id: number;
  writtenOffOn: string;
  reference: string;
  customer: string | null;
  verticalId: number | null;
  vertical: string | null;
  amount: number;
}

export interface BadDebtVerticalTotal {
  verticalId: number | null;
  vertical: string | null;
  total: number;
  count: number;
}

export interface BadDebtsResult {
  window: { start: string; end: string };
  total: number;
  count: number;
  customers: number;
  /** largest first; a row with no vertical is its own line */
  byVertical: BadDebtVerticalTotal[];
  rows: BadDebtLine[];
}

export async function buildBadDebts(opts: {
  entity: Entity;
  window: { start: string; end: string };
  verticalId?: number | null;
}): Promise<BadDebtsResult> {
  const { entity, window, verticalId = null } = opts;
  const rows = await query<{
    id: number;
    written_off_on: string;
    reference: string;
    customer: string | null;
    vertical_id: number | null;
    vertical: string | null;
    amount: string;
  }>(
    `select b.id, b.written_off_on::text, b.reference, b.customer, b.vertical_id,
            v.name as vertical, b.amount
       from bad_debts b
       left join verticals v on v.id = b.vertical_id
      where b.entity_id = any($1::int[])
        and b.written_off_on between $2 and $3
        and ($4::int is null or b.vertical_id = $4)
        ${verticalScope("$5", "b.vertical_id")}
      order by v.name nulls last, b.written_off_on, b.reference`,
    [entity.memberIds, window.start, window.end, verticalId, entity.verticalIds],
  );

  const lines: BadDebtLine[] = rows.map((r) => ({
    id: r.id,
    writtenOffOn: r.written_off_on,
    reference: r.reference,
    customer: r.customer,
    verticalId: r.vertical_id,
    vertical: r.vertical,
    amount: Number(r.amount),
  }));

  const byKey = new Map<string, BadDebtVerticalTotal>();
  for (const l of lines) {
    const key = String(l.verticalId);
    const entry = byKey.get(key) ?? { verticalId: l.verticalId, vertical: l.vertical, total: 0, count: 0 };
    entry.total += l.amount;
    entry.count += 1;
    byKey.set(key, entry);
  }

  return {
    window,
    total: lines.reduce((n, l) => n + l.amount, 0),
    count: lines.length,
    customers: new Set(lines.map((l) => l.customer ?? "")).size,
    byVertical: [...byKey.values()].sort((a, b) => b.total - a.total),
    rows: lines,
  };
}

/**
 * What was written off over a window, for the note under the Collections Actual. Null where there
 * is nothing written off for the view, so there is no note to make.
 */
export async function badDebtsWrittenOff(
  entity: Entity,
  window: { start: string; end: string },
  verticalId: number | null = null,
): Promise<number | null> {
  const row = await queryOne<{ n: number; v: number }>(
    `select count(*)::int as n, coalesce(sum(b.amount), 0)::float8 as v
       from bad_debts b
      where b.entity_id = any($1::int[])
        and b.written_off_on between $2 and $3
        and ($4::int is null or b.vertical_id = $4)
        ${verticalScope("$5", "b.vertical_id")}`,
    [entity.memberIds, window.start, window.end, verticalId, entity.verticalIds],
  );
  return (row?.n ?? 0) > 0 ? Number(row?.v ?? 0) : null;
}

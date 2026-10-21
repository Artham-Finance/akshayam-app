import { query } from "@/lib/db";
import { getVerticalsInScope, type Entity } from "@/lib/entity";
import { ROWS, scorecardRowCodeFor } from "@/lib/reports/scorecard";
import { addDays, isLocked, todayIst } from "@/lib/weekly";

/**
 * The MAK meeting's Receivables tab, for one week.
 *
 * Two things per vertical, both read from the latest receivables snapshot on
 * or before the week's end (the same rule the Collection tab reads):
 *
 *  1. Receivables over 90 and over 180 days, by customer, with the commitment the
 *     head makes for the week, the commitments of every earlier week (the whole
 *     history of the receivable) and the review of the latest of them.
 *  2. The ten customers who owe the most, with each one's share of the
 *     vertical's receivables and of the whole entity's.
 *
 * TDS receivable has a tab of its own (see tds-receivables.ts). The notes are the
 * only thing stored (see 072_weekly_receivable_notes.sql).
 */

export const OVER_DAYS = 180;
/** the lower bucket: over this many days, up to OVER_DAYS */
export const MID_DAYS = 90;

/** the two ageing buckets the head commits against: 91-180 days, and over 180 */
export type AgeBucket = "over90" | "over180";

export interface ReceivableInvoice {
  invoiceNumber: string;
  invoiceDate: string | null;
  dueDate: string | null;
  balance: number;
  ageDays: number;
}

export interface Over180Customer {
  customer: string;
  /** which bucket this line is: over 90 days (up to 180), or over 180 */
  bucket: AgeBucket;
  /** what is owed in the bucket */
  amount: number;
  invoices: ReceivableInvoice[];
  /** this week's commitment, as keyed */
  commitment: string | null;
  enteredOn: string | null;
  /** the commitment's text can no longer be changed */
  locked: boolean;
  /** what was committed in the most recent earlier week, and how it went - the one whose review is still being written */
  previous: EarlierCommitment | null;
  /**
   * Every earlier week the customer was committed on, newest first, from the first one: the
   * whole picture of the receivable. A customer who aged from the 91-180 bucket into over 180
   * carries its earlier commitments with it, each marked with the bucket it was made in.
   */
  history: EarlierCommitment[];
}

/** What was committed against a customer in an earlier week, and the review of it. */
export interface EarlierCommitment {
  /** the Saturday the week ended on */
  weekEnd: string;
  /** the ageing bucket the commitment was made in */
  bucket: AgeBucket;
  commitment: string | null;
  review: string | null;
}

export interface TopCustomer {
  rank: number;
  customer: string;
  outstanding: number;
  pctOfVertical: number;
  pctOfEntity: number;
  /** owed over 90 days, up to 180 */
  over90: number;
  over180: number;
  /** every open invoice behind the balance, the oldest first */
  invoices: ReceivableInvoice[];
}

export interface VerticalReceivables {
  verticalId: number;
  label: string;
  total: number;
  pctOfEntity: number;
  over90Total: number;
  over90: Over180Customer[];
  over180Total: number;
  over180: Over180Customer[];
  top: TopCustomer[];
}

export interface WeeklyReceivablesResult {
  weekEnd: string;
  arAsOf: string | null;
  /** the whole entity's open receivables at the snapshot - the base for "% of entity" */
  entityTotal: number;
  verticals: VerticalReceivables[];
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

export async function buildWeeklyReceivables(opts: {
  entity: Entity;
  weekEnd: string;
}): Promise<WeeklyReceivablesResult> {
  const { entity, weekEnd } = opts;
  const today = todayIst();
  const ids = entity.memberIds;
  const scoped = await getVerticalsInScope(entity);
  const scopedIds = scoped.map((v) => v.id);

  /* ---- the receivables snapshot, invoice by invoice ---- */
  const open = await query<{
    vertical_id: number | null;
    customer: string;
    invoice_number: string | null;
    invoice_date: string | null;
    due_date: string | null;
    balance: number;
    age: number;
    as_of: string;
  }>(
    `with snap as (
       select e.id as entity_id,
              coalesce(
                (select max(as_of) from ar_open_items where entity_id = e.id and as_of <= $2),
                (select min(as_of) from ar_open_items where entity_id = e.id)
              ) as as_of
         from unnest($1::int[]) as e(id)
     )
     select a.vertical_id,
            btrim(a.customer_name) as customer,
            a.invoice_number,
            a.invoice_date::text as invoice_date,
            a.due_date::text as due_date,
            a.balance_base::float8 as balance,
            (s.as_of - coalesce(a.due_date, a.invoice_date))::int as age,
            s.as_of::text as as_of
       from ar_open_items a
       join snap s on s.entity_id = a.entity_id and a.as_of = s.as_of
      where a.customer_name is not null
        -- a balance under a rupee is a rounding residue, not a receivable
        and a.balance_base >= 1`,
    [ids, weekEnd],
  );

  let arAsOf: string | null = null;
  for (const r of open) if (!arAsOf || r.as_of > arAsOf) arAsOf = r.as_of;
  // The base for "% of entity": every open receivable, whichever vertical it is tagged to.
  const entityTotal = open.reduce((s, r) => s + Number(r.balance), 0);

  const byVertical = new Map<number, typeof open>();
  for (const r of open) {
    if (r.vertical_id === null || !scopedIds.includes(r.vertical_id)) continue;
    const list = byVertical.get(r.vertical_id) ?? [];
    list.push(r);
    byVertical.set(r.vertical_id, list);
  }
  const verticalIds = [...byVertical.keys()];

  /* ---- the notes ---- */
  const notes =
    scopedIds.length === 0
      ? []
      : await query<{
          vertical_id: number;
          week_end: string;
          customer: string;
          kind: "over90" | "over180";
          commitment: string | null;
          entered_on: string;
          review: string | null;
          remark: string | null;
        }>(
          `select vertical_id, week_end::text, customer, kind, commitment, entered_on::text,
                  review, remark
             from weekly_receivable_notes
            where vertical_id = any($1::int[]) and week_end <= $2 and kind in ('over90', 'over180')
            order by week_end desc`,
          [scopedIds, weekEnd],
        );

  /* ---- assemble ---- */
  const labelFor = (id: number) => {
    const v = scoped.find((x) => x.id === id);
    const rowCode = v ? scorecardRowCodeFor(v.code) : null;
    return (rowCode ? ROWS.find((r) => r.code === rowCode)?.label : null) ?? v?.name ?? "Vertical";
  };

  const verticals: VerticalReceivables[] = verticalIds.map((vid) => {
    const rows = byVertical.get(vid) ?? [];
    const total = rows.reduce((s, r) => s + Number(r.balance), 0);

    // by customer
    const byCustomer = new Map<string, typeof rows>();
    for (const r of rows) {
      const key = r.customer;
      byCustomer.set(key, [...(byCustomer.get(key) ?? []), r]);
    }

    const over90: Over180Customer[] = [];
    const over180: Over180Customer[] = [];
    const topAll: TopCustomer[] = [];
    const lineOf = (r: (typeof rows)[number]) => ({
      invoiceNumber: r.invoice_number ?? "—",
      invoiceDate: r.invoice_date,
      dueDate: r.due_date,
      balance: Number(r.balance),
      ageDays: Number(r.age),
    });
    for (const [customer, list] of byCustomer) {
      const outstanding = list.reduce((s, r) => s + Number(r.balance), 0);
      const sumOf = (rs: typeof list) => rs.reduce((s, r) => s + Number(r.balance), 0);
      const mid = list.filter((r) => Number(r.age) > MID_DAYS && Number(r.age) <= OVER_DAYS);
      const old = list.filter((r) => Number(r.age) > OVER_DAYS);
      topAll.push({
        rank: 0,
        customer,
        outstanding,
        pctOfVertical: total > 0 ? outstanding / total : 0,
        pctOfEntity: entityTotal > 0 ? outstanding / entityTotal : 0,
        over90: sumOf(mid),
        over180: sumOf(old),
        invoices: list.map(lineOf).sort((a, b) => b.ageDays - a.ageDays),
      });

      // one line per customer in each bucket it has something in, with the head's notes for that bucket
      for (const [bucket, invoices, target] of [
        ["over90", mid, over90],
        ["over180", old, over180],
      ] as const) {
        const amount = sumOf(invoices);
        if (amount <= 0) continue;
        const mine = notes.filter(
          (n) => n.vertical_id === vid && n.kind === bucket && norm(n.customer) === norm(customer),
        );
        const current = mine.find((n) => n.week_end === weekEnd) ?? null;
        // An earlier week counts only if something was said in it - a commitment or a review. A
        // note left empty (typed, then cleared) is nothing committed earlier.
        const said = (n: (typeof notes)[number]) => !!n.commitment?.trim() || !!n.review?.trim();
        // The customer's earlier commitments in either bucket, newest first (the notes arrive so).
        const history: EarlierCommitment[] = notes
          .filter(
            (n) =>
              n.vertical_id === vid &&
              (n.kind === "over90" || n.kind === "over180") &&
              norm(n.customer) === norm(customer) &&
              n.week_end < weekEnd &&
              said(n),
          )
          .map((n) => ({
            weekEnd: n.week_end,
            bucket: n.kind as AgeBucket,
            commitment: n.commitment,
            review: n.review,
          }));
        target.push({
          customer,
          bucket,
          amount,
          invoices: invoices.map(lineOf).sort((a, b) => b.ageDays - a.ageDays),
          commitment: current?.commitment ?? null,
          enteredOn: current?.entered_on ?? null,
          locked: current ? isLocked(current.entered_on, null, today) : false,
          previous: history[0] ?? null,
          history,
        });
      }
    }
    over90.sort((a, b) => b.amount - a.amount);
    over180.sort((a, b) => b.amount - a.amount);

    const top = topAll
      .sort((a, b) => b.outstanding - a.outstanding)
      .slice(0, 10)
      .map((t, i) => ({ ...t, rank: i + 1 }));

    return {
      verticalId: vid,
      label: labelFor(vid),
      total,
      pctOfEntity: entityTotal > 0 ? total / entityTotal : 0,
      over90Total: over90.reduce((s, c) => s + c.amount, 0),
      over90,
      over180Total: over180.reduce((s, c) => s + c.amount, 0),
      over180,
      top,
    };
  });

  // In the scorecard's own order, then the rest by size.
  const order = (id: number) => {
    const v = scoped.find((x) => x.id === id);
    const code = v ? scorecardRowCodeFor(v.code) : null;
    const i = code ? ROWS.findIndex((r) => r.code === code) : -1;
    return i === -1 ? 999 : i;
  };
  verticals.sort((a, b) => order(a.verticalId) - order(b.verticalId) || b.total - a.total);

  void addDays;
  return {
    weekEnd,
    arAsOf,
    entityTotal,
    verticals,
  };
}

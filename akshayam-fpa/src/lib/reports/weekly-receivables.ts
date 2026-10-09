import { query } from "@/lib/db";
import { getVerticalsInScope, type Entity } from "@/lib/entity";
import { fyBounds } from "@/lib/period";
import { ROWS, scorecardRowCodeFor } from "@/lib/reports/scorecard";
import { TDS_ACCOUNTS, TDS_TOLERANCE } from "@/lib/reports/tds";
import { addDays, isLocked, todayIst } from "@/lib/weekly";

/**
 * The MAK meeting's Receivables tab, for one week.
 *
 * Three things per vertical, all read from the latest receivables snapshot on
 * or before the week's end (the same rule the Collection tab reads):
 *
 *  1. Receivables over 180 days, by customer, with the commitment the head
 *     makes for the week and - for what was committed the week before - the
 *     review and whether it was achieved.
 *  2. The ten customers who owe the most, with each one's share of the
 *     vertical's receivables and of the whole entity's.
 *  3. Every customer with receivables, the invoices raised on them this
 *     financial year, and the TDS on each as Zoho books it - set against the
 *     Form 26AS amount for that customer over the same stretch, with the
 *     difference, whether 26AS reflects it, and a follow-up remark.
 *
 * A customer can owe nothing and still have TDS to be claimed - it paid in full
 * and deducted tax - so the TDS list is not limited to customers with a
 * receivable: it also carries every customer with TDS booked in Zoho this year,
 * and any customer Form 26AS shows tax deducted for, even with no receivable.
 *
 * Form 26AS records tax deducted per deductor and quarter, not per invoice, so
 * the 26AS side is compared at the customer, never guessed down to an invoice.
 * The notes are the only thing stored (see 072_weekly_receivable_notes.sql).
 */

export const OVER_DAYS = 180;

export interface ReceivableInvoice {
  invoiceNumber: string;
  invoiceDate: string | null;
  dueDate: string | null;
  balance: number;
  ageDays: number;
}

export interface Over180Customer {
  customer: string;
  /** what is owed over 180 days */
  amount: number;
  invoices: ReceivableInvoice[];
  /** this week's commitment, as keyed */
  commitment: string | null;
  enteredOn: string | null;
  /** the commitment's text can no longer be changed */
  locked: boolean;
  /** what was committed in the most recent earlier week, and how it went */
  previous: {
    weekEnd: string;
    commitment: string | null;
    review: string | null;
    achieved: "yes" | "partly" | "no" | null;
  } | null;
}

export interface TopCustomer {
  rank: number;
  customer: string;
  outstanding: number;
  pctOfVertical: number;
  pctOfEntity: number;
  over180: number;
}

export type TdsReflected = "yes" | "partly" | "no" | "na";

export interface TdsInvoice {
  invoiceNumber: string;
  invoiceDate: string | null;
  /** invoice value, ex tax */
  amount: number;
  /** the TDS receivable booked on it in Zoho */
  tdsZoho: number;
}

export interface TdsCustomer {
  customer: string;
  outstanding: number;
  invoices: TdsInvoice[];
  tdsZoho: number;
  /** tax deducted for this customer in Form 26AS over the same stretch */
  tds26as: number;
  difference: number;
  reflected: TdsReflected;
  remark: string | null;
  remarkWeekEnd: string | null;
}

export interface VerticalReceivables {
  verticalId: number;
  label: string;
  total: number;
  pctOfEntity: number;
  over180Total: number;
  over180: Over180Customer[];
  top: TopCustomer[];
  tds: TdsCustomer[];
  /** how many of the TDS customers owe nothing at the snapshot */
  tdsNoReceivable: number;
}

export interface WeeklyReceivablesResult {
  weekEnd: string;
  arAsOf: string | null;
  /** the whole entity's open receivables at the snapshot - the base for "% of entity" */
  entityTotal: number;
  /** the financial year's start, the beginning of the TDS stretch */
  tdsFrom: string;
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
  const fy = Number(weekEnd.slice(5, 7)) >= entity.fy_start_month
    ? Number(weekEnd.slice(0, 4))
    : Number(weekEnd.slice(0, 4)) - 1;
  const tdsFrom = fyBounds(fy, entity.fy_start_month).start;

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
          kind: "over180" | "tds";
          commitment: string | null;
          entered_on: string;
          review: string | null;
          achieved: "yes" | "partly" | "no" | null;
          remark: string | null;
        }>(
          `select vertical_id, week_end::text, customer, kind, commitment, entered_on::text,
                  review, achieved, remark
             from weekly_receivable_notes
            where vertical_id = any($1::int[]) and week_end <= $2
            order by week_end desc`,
          [scopedIds, weekEnd],
        );

  /* ---- invoices raised this financial year, and the TDS booked on each ---- */
  const invoices =
    scopedIds.length === 0
      ? []
      : await query<{
          vertical_id: number;
          customer: string;
          invoice_number: string;
          invoice_date: string | null;
          amount: number;
          tds: number;
        }>(
          `with inv as (
             select i.vertical_id, btrim(i.customer_name) as customer, i.invoice_number,
                    min(i.invoice_date)::text as invoice_date,
                    sum(i.amount_base)::float8 as amount
               from invoice_lines i
              where i.entity_id = any($1::int[]) and i.invoice_date between $2 and $3
                and i.vertical_id = any($4::int[]) and i.customer_name is not null
              group by 1, 2, 3
           ),
           tds as (
             select g.txn_number as invoice_number, sum(g.debit - g.credit)::float8 as tds
               from gl_entries g join accounts a on a.id = g.account_id
              where g.entity_id = any($1::int[]) and g.txn_date between $2 and $3
                and g.txn_number is not null and ${TDS_ACCOUNTS}
              group by 1
           )
           select inv.vertical_id, inv.customer, inv.invoice_number, inv.invoice_date, inv.amount,
                  coalesce(tds.tds, 0) as tds
             from inv left join tds on tds.invoice_number = inv.invoice_number
            order by inv.invoice_date desc, inv.invoice_number`,
          [ids, tdsFrom, weekEnd, scopedIds],
        );

  /* ---- Form 26AS, by customer, over the same stretch ---- */
  const form26as =
    scopedIds.length === 0
      ? []
      : await query<{ vertical_id: number | null; customer: string; amount: number }>(
          `select vertical_id, btrim(customer_name) as customer, sum(tax_deducted)::float8 as amount
             from tds_entries
            where entity_id = any($1::int[]) and transaction_date between $2 and $3
              and customer_name is not null
            group by 1, 2`,
          [ids, tdsFrom, weekEnd],
        );

  /* ---- assemble ---- */
  const labelFor = (id: number) => {
    const v = scoped.find((x) => x.id === id);
    const rowCode = v ? scorecardRowCodeFor(v.code) : null;
    return (rowCode ? ROWS.find((r) => r.code === rowCode)?.label : null) ?? v?.name ?? "Vertical";
  };

  /*
    The customers whose TDS is listed, by vertical: everyone who owes, plus anyone
    with TDS booked in Zoho this year or tax deducted in Form 26AS, owing or not.
  */
  const tdsPairs = new Map<number, Map<string, string>>();
  const addPair = (vid: number, customer: string) => {
    const key = norm(customer);
    if (!key) return;
    const m = tdsPairs.get(vid) ?? new Map<string, string>();
    if (!m.has(key)) m.set(key, customer.trim());
    tdsPairs.set(vid, m);
  };
  for (const vid of verticalIds) for (const r of byVertical.get(vid) ?? []) addPair(vid, r.customer);
  const zohoByPair = new Map<string, number>();
  for (const i of invoices) {
    const k = `${i.vertical_id}|${norm(i.customer)}`;
    zohoByPair.set(k, (zohoByPair.get(k) ?? 0) + Number(i.tds));
  }
  for (const i of invoices) {
    if (Math.abs(zohoByPair.get(`${i.vertical_id}|${norm(i.customer)}`) ?? 0) >= TDS_TOLERANCE) {
      addPair(i.vertical_id, i.customer);
    }
  }
  for (const f of form26as) {
    if (f.vertical_id !== null && scopedIds.includes(f.vertical_id) && Math.abs(Number(f.amount)) >= TDS_TOLERANCE) {
      addPair(f.vertical_id, f.customer);
    }
  }

  const renderIds = [...new Set([...verticalIds, ...tdsPairs.keys()])];

  const verticals: VerticalReceivables[] = renderIds.map((vid) => {
    const rows = byVertical.get(vid) ?? [];
    const total = rows.reduce((s, r) => s + Number(r.balance), 0);

    // by customer
    const byCustomer = new Map<string, typeof rows>();
    for (const r of rows) {
      const key = r.customer;
      byCustomer.set(key, [...(byCustomer.get(key) ?? []), r]);
    }

    const over180: Over180Customer[] = [];
    const topAll: TopCustomer[] = [];
    for (const [customer, list] of byCustomer) {
      const outstanding = list.reduce((s, r) => s + Number(r.balance), 0);
      const old = list.filter((r) => Number(r.age) > OVER_DAYS);
      const oldAmount = old.reduce((s, r) => s + Number(r.balance), 0);
      topAll.push({
        rank: 0,
        customer,
        outstanding,
        pctOfVertical: total > 0 ? outstanding / total : 0,
        pctOfEntity: entityTotal > 0 ? outstanding / entityTotal : 0,
        over180: oldAmount,
      });
      if (oldAmount <= 0) continue;

      const mine = notes.filter(
        (n) => n.vertical_id === vid && n.kind === "over180" && norm(n.customer) === norm(customer),
      );
      const current = mine.find((n) => n.week_end === weekEnd) ?? null;
      const earlier = mine.find((n) => n.week_end < weekEnd) ?? null;
      over180.push({
        customer,
        amount: oldAmount,
        invoices: old
          .map((r) => ({
            invoiceNumber: r.invoice_number ?? "—",
            invoiceDate: r.invoice_date,
            dueDate: r.due_date,
            balance: Number(r.balance),
            ageDays: Number(r.age),
          }))
          .sort((a, b) => b.ageDays - a.ageDays),
        commitment: current?.commitment ?? null,
        enteredOn: current?.entered_on ?? null,
        locked: current ? isLocked(current.entered_on, null, today) : false,
        previous: earlier
          ? {
              weekEnd: earlier.week_end,
              commitment: earlier.commitment,
              review: earlier.review,
              achieved: earlier.achieved,
            }
          : null,
      });
    }
    over180.sort((a, b) => b.amount - a.amount);

    const top = topAll
      .sort((a, b) => b.outstanding - a.outstanding)
      .slice(0, 10)
      .map((t, i) => ({ ...t, rank: i + 1 }));

    // TDS: every customer who owes or has TDS, with the invoices raised on them this year
    const tdsCustomers: TdsCustomer[] = [...(tdsPairs.get(vid)?.values() ?? [])].map((customer) => {
      const mine = invoices
        .filter((i) => i.vertical_id === vid && norm(i.customer) === norm(customer))
        .map((i) => ({
          invoiceNumber: i.invoice_number,
          invoiceDate: i.invoice_date,
          amount: Number(i.amount),
          tdsZoho: Number(i.tds),
        }));
      const tdsZoho = mine.reduce((s, i) => s + i.tdsZoho, 0);
      // 26AS carries the vertical only where the deductor was matched to one; a
      // customer matched to this vertical's name counts, whichever it was tagged to.
      const tds26as = form26as
        .filter((f) => norm(f.customer) === norm(customer) && (f.vertical_id === vid || f.vertical_id === null))
        .reduce((s, f) => s + Number(f.amount), 0);
      const hasZoho = Math.abs(tdsZoho) >= TDS_TOLERANCE;
      const reflected: TdsReflected = !hasZoho
        ? "na"
        : tds26as >= tdsZoho - TDS_TOLERANCE
          ? "yes"
          : tds26as >= TDS_TOLERANCE
            ? "partly"
            : "no";
      const note =
        notes.find(
          (n) => n.vertical_id === vid && n.kind === "tds" && norm(n.customer) === norm(customer),
        ) ?? null;
      return {
        customer,
        outstanding: rows
          .filter((r) => norm(r.customer) === norm(customer))
          .reduce((s, r) => s + Number(r.balance), 0),
        invoices: mine,
        tdsZoho,
        tds26as,
        difference: tdsZoho - tds26as,
        reflected,
        remark: note?.remark ?? null,
        remarkWeekEnd: note?.week_end ?? null,
      };
    });
    // Who owes most first; among those who owe nothing, the largest TDS gap first.
    tdsCustomers.sort(
      (a, b) => b.outstanding - a.outstanding || Math.abs(b.difference) - Math.abs(a.difference),
    );

    return {
      verticalId: vid,
      label: labelFor(vid),
      total,
      pctOfEntity: entityTotal > 0 ? total / entityTotal : 0,
      over180Total: over180.reduce((s, c) => s + c.amount, 0),
      over180,
      top,
      tds: tdsCustomers,
      tdsNoReceivable: tdsCustomers.filter((c) => c.outstanding < TDS_TOLERANCE).length,
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
  return { weekEnd, arAsOf, entityTotal, tdsFrom, verticals };
}

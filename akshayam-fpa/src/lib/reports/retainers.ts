import { query } from "@/lib/db";
import { verticalScope, type Entity } from "@/lib/entity";
import { fyMonths, type FyMonth } from "@/lib/period";

/**
 * Recurring retainership fee, by customer and month.
 *
 * The revenue page carries retainership as one figure, which is the right
 * altitude for a headline and useless for the question actually asked of it -
 * which clients are on a retainer, and has any of them stopped paying one.
 * A customer whose retainer runs Apr to Jun and then stops is invisible in a
 * total and obvious in a row.
 *
 * Read straight from what was loaded: the retainer file is a list of customer,
 * month and amount, so this is that list pivoted, not a derivation.
 */

export interface RetainerRow {
  customer: string;
  vertical: string | null;
  /** month key -> amount */
  byMonth: Record<string, number>;
  total: number;
  /** the months this customer was actually billed in, for spotting a stop */
  billedMonths: number;
}

export interface RetainerResult {
  months: FyMonth[];
  /** only the months anything was billed in, so the table is not mostly empty */
  activeMonths: FyMonth[];
  rows: RetainerRow[];
  totalsByMonth: Record<string, number>;
  total: number;
  /** verticals present in the data, for the picker */
  verticals: { id: number; name: string }[];
}

export async function buildRetainerBreakdown(opts: {
  entity: Entity;
  fyStartYear: number;
  verticalId?: number | null;
}): Promise<RetainerResult> {
  const { entity, fyStartYear, verticalId = null } = opts;
  const months = fyMonths(fyStartYear);
  const start = months[0].start;
  const end = months[months.length - 1].end;

  const [rows, verticalRows] = await Promise.all([
    query<{ customer_name: string; vertical: string | null; month_key: string; amount: number }>(
      `select r.customer_name,
              v.name as vertical,
              to_char(r.month, 'YYYY-MM') as month_key,
              sum(r.amount_base)::numeric as amount
         from retainer_revenue r
         left join verticals v on v.id = r.vertical_id
        where r.entity_id = any($1::int[]) and r.month between $2 and $3
          and ($4::int is null or r.vertical_id = $4)
          ${verticalScope("$5", "r.vertical_id")}
        group by r.customer_name, v.name, to_char(r.month, 'YYYY-MM')`,
      [entity.memberIds, start, end, verticalId, entity.verticalIds],
    ),
    /**
     * The picker's options come from the retainer data itself, not from every
     * vertical the company has: offering a vertical that turns the table empty
     * reads as a broken filter.
     */
    query<{ id: number; name: string }>(
      `select distinct v.id, v.name
         from retainer_revenue r
         join verticals v on v.id = r.vertical_id
        where r.entity_id = any($1::int[]) and r.month between $2 and $3
          ${verticalScope("$4", "r.vertical_id")}
        order by v.name`,
      [entity.memberIds, start, end, entity.verticalIds],
    ),
  ]);

  const byCustomer = new Map<string, RetainerRow>();
  const totalsByMonth: Record<string, number> = {};

  for (const row of rows) {
    const amount = Number(row.amount);
    // One customer can sit under two verticals across the two companies; the
    // row is keyed on the pair so neither is silently folded into the other.
    const key = `${row.customer_name}|${row.vertical ?? ""}`;
    const found =
      byCustomer.get(key) ??
      {
        customer: row.customer_name,
        vertical: row.vertical,
        byMonth: {},
        total: 0,
        billedMonths: 0,
      };
    found.byMonth[row.month_key] = (found.byMonth[row.month_key] ?? 0) + amount;
    found.total += amount;
    byCustomer.set(key, found);
    totalsByMonth[row.month_key] = (totalsByMonth[row.month_key] ?? 0) + amount;
  }

  for (const row of byCustomer.values()) {
    row.billedMonths = Object.values(row.byMonth).filter((v) => Math.abs(v) > 0.5).length;
  }

  const activeMonths = months.filter((m) => Math.abs(totalsByMonth[m.key] ?? 0) > 0.5);

  return {
    months,
    activeMonths,
    // Biggest retainer first: the table is read from the top and stopped at.
    rows: [...byCustomer.values()].sort((a, b) => b.total - a.total),
    totalsByMonth,
    total: Object.values(totalsByMonth).reduce((s, v) => s + v, 0),
    verticals: verticalRows,
  };
}

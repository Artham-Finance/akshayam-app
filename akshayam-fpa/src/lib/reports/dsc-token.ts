import { queryOne } from "@/lib/db";
import type { Entity } from "@/lib/entity";
import { fyMonths } from "@/lib/period";

/**
 * The DSC token stock-take: what the books say is in hand against what was
 * counted, one month at a time.
 *
 * Book value comes straight from the ledger - the balance of the "DSC Asset
 * Token" account as at the month end. The book quantity and the physical count
 * (qty and value) are keyed in on the Receivables page once a month, after the
 * month-end entry has been posted.
 */

export interface DscTokenResult {
  /** the FY months, for the picker */
  months: { key: string; label: string }[];
  /** the month being shown, YYYY-MM */
  monthKey: string;
  /** first day of that month, YYYY-MM-DD - what the keyed row is stored against */
  monthStart: string;
  /** "DSC Asset Token" balance as at the month end, from the ledger */
  bookValue: number;
  /** keyed: tokens the books say are in hand */
  bookQty: number;
  /** keyed: tokens actually counted */
  physicalQty: number;
  /** keyed: what that count is worth */
  physicalValue: number;
}

const TOKEN_ACCOUNT = "DSC Asset Token";

export async function buildDscToken(opts: {
  entity: Entity;
  verticalId: number;
  fyStartYear: number;
  /** the latest date the books reach, e.g. the AR snapshot - the default month */
  latest: string;
  /** YYYY-MM; overrides the default when the picker has been used */
  month: string | null;
}): Promise<DscTokenResult> {
  const { entity, verticalId, fyStartYear, latest } = opts;
  const monthList = fyMonths(fyStartYear);

  const defaultMonth =
    [...monthList].reverse().find((m) => m.start <= latest) ?? monthList[0];
  const chosen =
    monthList.find((m) => m.key === opts.month) ?? defaultMonth;
  const monthKey = chosen.key;

  const [bookRow, keyed] = await Promise.all([
    // The account's running balance to the last day of the chosen month:
    // prior-year opening plus every posting on or before that date.
    queryOne<{ value: number }>(
      `select coalesce((
                select sum(o.debit - o.credit)
                  from opening_balances o
                  join accounts a on a.id = o.account_id
                 where a.entity_id = any($1::int[]) and a.name = $2
                   and o.as_of <= $3
              ), 0)
            + coalesce((
                select sum(g.debit - g.credit)
                  from gl_entries g
                  join accounts a on a.id = g.account_id
                 where a.entity_id = any($1::int[]) and a.name = $2
                   and g.txn_date <= $3
              ), 0) as value`,
      [entity.memberIds, TOKEN_ACCOUNT, chosen.end],
    ),
    queryOne<{
      book_qty: number;
      physical_qty: number;
      physical_value: number;
    }>(
      `select book_qty, physical_qty, physical_value
         from dsc_token_count
        where entity_id = $1 and vertical_id = $2 and month = $3`,
      [entity.id, verticalId, `${chosen.key}-01`],
    ),
  ]);

  return {
    months: monthList.map((m) => ({ key: m.key, label: m.label })),
    monthKey,
    monthStart: `${chosen.key}-01`,
    bookValue: Number(bookRow?.value ?? 0),
    bookQty: Number(keyed?.book_qty ?? 0),
    physicalQty: Number(keyed?.physical_qty ?? 0),
    physicalValue: Number(keyed?.physical_value ?? 0),
  };
}

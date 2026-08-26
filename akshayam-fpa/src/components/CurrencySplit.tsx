import clsx from "clsx";
import { money, percent, share } from "@/lib/format";

/**
 * What was billed or received, split by the currency it was denominated in.
 *
 * Every total in the app is INR, because a statement in two currencies adds up
 * to nothing. That is the right basis and it is kept - but it answers a
 * different question from the one a GIFT-city client's account manager asks.
 * "We collected 15.2 lakh" and "we collected 16,024 dollars" are both true and
 * only one of them is the figure that was actually agreed with the client.
 *
 * So both are shown, side by side, with the rate that connects them. The rate
 * is derived rather than stored: it is what the two columns imply, which is
 * the only rate that can be checked against the figures beside it.
 */

export interface CurrencyRow {
  currency: string;
  /** invoices, or receipts */
  count: number;
  /** the figure in the currency itself; null for the base currency */
  foreign: number | null;
  /** the same money in INR */
  inr: number;
}

export function CurrencySplit({
  rows,
  countLabel,
  baseCurrency = "INR",
}: {
  rows: CurrencyRow[];
  /** what the count column is counting, e.g. "Receipts" */
  countLabel: string;
  baseCurrency?: string;
}) {
  const head =
    "border-y border-line px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-faint";
  const cell = "border-b border-line px-3 py-2";
  const total = rows.reduce((s, r) => s + r.inr, 0);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max border-collapse text-[13px]">
        <caption className="px-3 pb-3 text-left text-[11.5px] text-ink-muted">
          Amounts are shown in the currency they were denominated in and in
          rupees. The rate is what the two imply over the period, not a rate on
          any one transaction.
        </caption>
        <thead>
          <tr>
            <th scope="col" className={clsx(head, "text-left")}>
              Currency
            </th>
            <th scope="col" className={clsx(head, "text-right")}>
              {countLabel}
            </th>
            <th scope="col" className={clsx(head, "text-right")}>
              In currency
            </th>
            <th scope="col" className={clsx(head, "text-right")}>
              In rupees
            </th>
            <th scope="col" className={clsx(head, "text-right")}>
              Rate
            </th>
            <th scope="col" className={clsx(head, "text-right")}>
              Share
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isBase = row.currency.toUpperCase() === baseCurrency;
            const rate = row.foreign && row.foreign !== 0 ? row.inr / row.foreign : null;
            return (
              <tr key={row.currency} className="hover:bg-surface-sunk/50">
                <th scope="row" className={clsx(cell, "text-left font-medium text-ink")}>
                  {row.currency}
                </th>
                <td className={clsx(cell, "num text-right text-ink-muted")}>{row.count}</td>
                <td className={clsx(cell, "num text-right text-ink")}>
                  {isBase || row.foreign === null ? (
                    <span className="text-ink-faint">—</span>
                  ) : (
                    money(row.foreign, 2)
                  )}
                </td>
                <td className={clsx(cell, "num text-right font-medium text-ink")}>
                  {money(row.inr)}
                </td>
                <td className={clsx(cell, "num text-right text-ink-muted")}>
                  {rate === null ? <span className="text-ink-faint">—</span> : money(rate, 2)}
                </td>
                <td className={clsx(cell, "num text-right text-ink-muted")}>
                  {percent(share(row.inr, total))}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="bg-surface-sunk font-semibold">
            <th scope="row" className="border-y border-line-strong px-3 py-2 text-left">
              Total
            </th>
            <td className="num border-y border-line-strong px-3 py-2 text-right">
              {rows.reduce((s, r) => s + r.count, 0)}
            </td>
            <td className="border-y border-line-strong px-3 py-2" />
            <td className="num border-y border-line-strong px-3 py-2 text-right">
              {money(total)}
            </td>
            <td className="border-y border-line-strong px-3 py-2" />
            <td className="num border-y border-line-strong px-3 py-2 text-right">100.0%</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

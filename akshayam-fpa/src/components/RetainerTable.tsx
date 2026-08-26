import clsx from "clsx";
import { money } from "@/lib/format";
import type { RetainerResult } from "@/lib/reports/retainers";

/**
 * Retainership fee by customer and month.
 *
 * Customers down the side, months across, largest retainer first. Only the
 * months something was billed in get a column - a year's worth of empty ones
 * would push the months that matter off the side of the screen.
 *
 * A blank cell is a month a customer was not billed a retainer, and that is
 * the point of reading the table: a row that stops halfway across is a client
 * whose retainer stopped, which a total can never show.
 */
export function RetainerTable({
  data,
  showVertical,
}: {
  data: RetainerResult;
  /** false when a single vertical is picked and the column would repeat */
  showVertical: boolean;
}) {
  const head =
    "border-y border-line px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-faint";
  const cell = "border-b border-line px-3 py-2";
  const months = data.activeMonths;

  return (
    <div className="overflow-x-auto scroll-fade">
      <table className="w-full min-w-max border-collapse text-[13px]">
        <caption className="px-3 pb-3 text-left text-[11.5px] text-ink-muted">
          {data.rows.length} customer{data.rows.length === 1 ? "" : "s"} on a retainer, largest
          first. A blank month is one the customer was not billed a retainer in.
        </caption>
        <thead>
          <tr>
            <th scope="col" className={clsx(head, "sticky-label bg-surface text-left")}>
              Customer
            </th>
            {showVertical && (
              <th scope="col" className={clsx(head, "text-left")}>
                Vertical
              </th>
            )}
            {months.map((m) => (
              <th key={m.key} scope="col" className={clsx(head, "text-right")}>
                {m.label}
              </th>
            ))}
            <th scope="col" className={clsx(head, "border-l border-line text-right")}>
              Total
            </th>
            <th scope="col" className={clsx(head, "text-right")}>
              Months
            </th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row) => (
            <tr key={`${row.customer}|${row.vertical ?? ""}`} className="hover:bg-surface-sunk/50">
              <th
                scope="row"
                className={clsx(cell, "sticky-label bg-surface text-left font-normal text-ink")}
              >
                {row.customer}
              </th>
              {showVertical && (
                <td className={clsx(cell, "text-left text-[12px] text-ink-muted")}>
                  {row.vertical ?? <span className="text-ink-faint">—</span>}
                </td>
              )}
              {months.map((m) => {
                const value = row.byMonth[m.key] ?? 0;
                return (
                  <td key={m.key} className={clsx(cell, "num text-right text-ink-muted")}>
                    {Math.abs(value) < 0.5 ? (
                      <span className="text-ink-faint">&ndash;</span>
                    ) : (
                      money(value)
                    )}
                  </td>
                );
              })}
              <td className={clsx(cell, "num border-l border-line text-right font-medium text-ink")}>
                {money(row.total)}
              </td>
              <td
                className={clsx(
                  cell,
                  "num text-right text-[12px]",
                  // A retainer that ran for fewer months than the table covers
                  // is the thing worth noticing.
                  row.billedMonths < months.length ? "text-caution" : "text-ink-faint",
                )}
                title={
                  row.billedMonths < months.length
                    ? `Billed in ${row.billedMonths} of ${months.length} months`
                    : undefined
                }
              >
                {row.billedMonths}/{months.length}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-surface-sunk font-semibold">
            <th
              scope="row"
              className="sticky-label border-y border-line-strong bg-surface-sunk px-3 py-2 text-left"
            >
              Total
            </th>
            {showVertical && <td className="border-y border-line-strong px-3 py-2" />}
            {months.map((m) => (
              <td
                key={m.key}
                className="num border-y border-line-strong px-3 py-2 text-right"
              >
                {money(data.totalsByMonth[m.key] ?? 0)}
              </td>
            ))}
            <td className="num border-y border-l border-line-strong px-3 py-2 text-right">
              {money(data.total)}
            </td>
            <td className="border-y border-line-strong px-3 py-2" />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

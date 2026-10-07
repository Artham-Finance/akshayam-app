import clsx from "clsx";
import { money, moneySigned, percent } from "@/lib/format";
import type { ReimbursementSummary } from "@/lib/reports/expense-detail";

/**
 * The two sides of the statement's "Reimbursable Costs Recovered (net)" line,
 * shown apart from the Overheads breakup so that breakup agrees with the
 * statement's Overheads figure.
 *
 * Reimbursement expense is a cost the firm paid and billed on; reimbursement
 * income is the billing. Only their net carries a budget - the planning
 * workbook has one line for it - so the two sides show an actual alone and the
 * net is the row that is compared. Variance is actual less budget, since a
 * recovery above plan is the favourable direction.
 */
export function ReimbursementsTable({
  data,
  periodLabel,
  ytdLabel,
}: {
  data: ReimbursementSummary;
  periodLabel: string;
  ytdLabel: string;
}) {
  const head =
    "border-y border-line px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-faint";
  const subhead = "mt-0.5 block text-[10px] font-normal normal-case tracking-normal text-ink-faint";
  const cell = "border-b border-line px-3 py-2";

  const { period, ytd } = data;
  const variance = ytd.net - ytd.budget;
  const variancePct = ytd.budget ? (variance / Math.abs(ytd.budget)) * 100 : null;

  return (
    <div className="table-frame">
      <table className="w-full min-w-max border-collapse text-[13px]">
        <thead>
          <tr>
            <th scope="col" className={clsx(head, "text-left")}>
              Particulars
            </th>
            <th scope="col" className={clsx(head, "text-right")}>
              Period budget
              <span className={subhead}>{periodLabel}</span>
            </th>
            <th scope="col" className={clsx(head, "text-right")}>
              Period actuals
              <span className={subhead}>{periodLabel}</span>
            </th>
            <th scope="col" className={clsx(head, "text-right")}>
              YTD budget
              <span className={subhead}>{ytdLabel}</span>
            </th>
            <th scope="col" className={clsx(head, "text-right")}>
              YTD actuals
              <span className={subhead}>{ytdLabel}</span>
            </th>
            <th scope="col" className={clsx(head, "text-right")}>
              Variance (YTD)
            </th>
            <th scope="col" className={clsx(head, "text-right")}>
              % (YTD)
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row" className={clsx(cell, "text-left font-normal text-ink")}>
              Reimbursement expenses
              <span className="mt-0.5 block text-[11px] text-ink-faint">
                RE - costs paid and billed on to clients
              </span>
            </th>
            <td className={clsx(cell, "num text-right text-ink-faint")}>—</td>
            <td className={clsx(cell, "num text-right text-ink")}>{money(period.expense)}</td>
            <td className={clsx(cell, "num text-right text-ink-faint")}>—</td>
            <td className={clsx(cell, "num text-right text-ink")}>{money(ytd.expense)}</td>
            <td className={clsx(cell, "num text-right text-ink-faint")}>—</td>
            <td className={clsx(cell, "num text-right text-ink-faint")}>—</td>
          </tr>
          <tr>
            <th scope="row" className={clsx(cell, "text-left font-normal text-ink")}>
              Less: Reimbursement income
              <span className="mt-0.5 block text-[11px] text-ink-faint">
                RI - the same costs, billed
              </span>
            </th>
            <td className={clsx(cell, "num text-right text-ink-faint")}>—</td>
            <td className={clsx(cell, "num text-right text-ink")}>{money(period.income)}</td>
            <td className={clsx(cell, "num text-right text-ink-faint")}>—</td>
            <td className={clsx(cell, "num text-right text-ink")}>{money(ytd.income)}</td>
            <td className={clsx(cell, "num text-right text-ink-faint")}>—</td>
            <td className={clsx(cell, "num text-right text-ink-faint")}>—</td>
          </tr>
        </tbody>
        <tfoot>
          <tr className="font-semibold text-ink">
            <th scope="row" className="border-t border-line-strong px-3 py-2 text-left">
              Reimbursable costs recovered (net)
              <span className="mt-0.5 block text-[11px] font-normal text-ink-faint">
                Income less expense - the statement&rsquo;s own line
              </span>
            </th>
            <td className="num border-t border-line-strong px-3 py-2 text-right text-ink-muted">
              {money(period.budget)}
            </td>
            <td className="num border-t border-line-strong px-3 py-2 text-right">
              {moneySigned(period.net)}
            </td>
            <td className="num border-t border-line-strong px-3 py-2 text-right text-ink-muted">
              {money(ytd.budget)}
            </td>
            <td className="num border-t border-line-strong px-3 py-2 text-right">
              {moneySigned(ytd.net)}
            </td>
            <td
              className={clsx(
                "num border-t border-line-strong px-3 py-2 text-right",
                variance < 0 ? "text-negative" : "text-ink-muted",
              )}
            >
              {moneySigned(variance)}
            </td>
            <td
              className={clsx(
                "num border-t border-line-strong px-3 py-2 text-right",
                variancePct !== null && variancePct < 0 ? "text-negative" : "text-ink-muted",
              )}
            >
              {variancePct === null ? "—" : percent(variancePct)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

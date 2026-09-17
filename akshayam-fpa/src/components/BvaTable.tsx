import clsx from "clsx";
import { money, percent } from "@/lib/format";
import type { BvaLine } from "@/lib/reports/budget-pnl";
import type { FyMonth } from "@/lib/period";

const sum = (values: Record<string, number>, months: FyMonth[]) =>
  months.reduce((total, m) => total + (values[m.key] ?? 0), 0);

/**
 * Budget against actual, down the statement.
 *
 * Same Period / YTD shape as the Other-expenses and cost breakdown cards
 * below it: the period columns read whatever the page's own picker is
 * showing, the YTD columns read the year to date always, and variance and
 * its percentage are struck on the YTD pair only.
 *
 * A cost line holds a positive magnitude, so "variance" has to mean the same
 * thing on every row: **better or worse than budget**. Spending less than
 * budget is favourable and earning less is not, and a table that showed both
 * as a plain subtraction would colour half of them the wrong way.
 */
export function BvaStatement({
  lines,
  periodMonths,
  ytdMonths,
  periodLabel,
  ytdLabel,
}: {
  lines: BvaLine[];
  periodMonths: FyMonth[];
  ytdMonths: FyMonth[];
  /** short label for the period columns, e.g. "This month" or "Jul 26" */
  periodLabel: string;
  /** short label for the YTD columns, e.g. "to 27 Aug 26" */
  ytdLabel: string;
}) {
  const head =
    "border-y border-line px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-faint";
  const subhead = "mt-0.5 block text-[10px] font-normal normal-case tracking-normal text-ink-faint";

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max border-collapse text-[13px]">
        <caption className="px-4 pb-3 text-left text-[11.5px] text-ink-muted">
          A favourable variance is more revenue, or less cost, than budget.
        </caption>
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
          {lines.map((line) => {
            const periodBudget = sum(line.budget, periodMonths);
            const periodActual = sum(line.actual, periodMonths);
            const ytdBudget = sum(line.budget, ytdMonths);
            const ytdActual = sum(line.actual, ytdMonths);
            // Costs are held positive, so under-spending is the favourable case.
            const ytdVariance = line.sign === -1 ? ytdBudget - ytdActual : ytdActual - ytdBudget;
            const ytdPct = ytdBudget === 0 ? null : (ytdVariance / ytdBudget) * 100;
            const favourable = ytdVariance >= -0.5;

            return (
              <tr
                key={line.code}
                className={clsx(
                  line.isSubtotal ? "bg-surface-sunk font-semibold" : "hover:bg-surface-sunk/50",
                )}
              >
                <th
                  scope="row"
                  className={clsx(
                    "border-b border-line px-4 py-2 text-left text-ink",
                    line.isSubtotal ? "font-semibold" : "font-normal",
                    line.sign === -1 && !line.isSubtotal && "pl-8",
                  )}
                >
                  {line.sign === -1 && !line.isSubtotal ? `Less: ${line.name}` : line.name}
                </th>
                <td className="num border-b border-line px-4 py-2 text-right text-ink-muted">
                  {money(periodBudget)}
                </td>
                <td
                  className={clsx(
                    "num border-b border-line px-4 py-2 text-right font-medium",
                    periodActual < -0.5 ? "num-negative text-negative" : "text-ink",
                  )}
                >
                  {money(periodActual)}
                </td>
                <td className="num border-b border-line px-4 py-2 text-right text-ink-muted">
                  {money(ytdBudget)}
                </td>
                <td
                  className={clsx(
                    "num border-b border-line px-4 py-2 text-right font-medium",
                    ytdActual < -0.5 ? "num-negative text-negative" : "text-ink",
                  )}
                >
                  {money(ytdActual)}
                </td>
                <td
                  className={clsx(
                    "num border-b border-line px-4 py-2 text-right",
                    favourable ? "text-positive" : "num-negative text-negative",
                  )}
                >
                  {money(ytdVariance)}
                </td>
                <td
                  className={clsx(
                    "num border-b border-line px-4 py-2 text-right",
                    ytdPct === null ? "text-ink-faint" : favourable ? "text-positive" : "text-caution",
                  )}
                >
                  {ytdPct === null ? "—" : percent(ytdPct, 1)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Common-size P&L: every line as a percentage of that month's revenue.
 *
 * Rupees say what happened; common size says whether the shape of the business
 * changed. A month whose revenue halved shows every cost line jumping as a
 * percentage, which is exactly the signal worth having.
 */
export function CommonSize({
  lines,
  months,
  budgetColumn,
}: {
  lines: BvaLine[];
  months: FyMonth[];
  budgetColumn: boolean;
}) {
  const head =
    "border-y border-line px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-faint";
  const revenue = lines.find((l) => l.code === "revenue")!;

  // Months with no revenue at all are dropped: every percentage in them would
  // be a division by zero dressed up as a dash, and a column of dashes only
  // pushes the months that matter off the side of the screen.
  const shown = months.filter((m) => Math.abs(revenue.actual[m.key]) > 0.5);
  const fyRevenue = months.reduce((s, m) => s + revenue.actual[m.key], 0);
  const fyBudgetRevenue = months.reduce((s, m) => s + revenue.budget[m.key], 0);

  const cell = (value: number, base: number) =>
    Math.abs(base) < 0.5 ? "—" : percent((value / base) * 100, 1);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max border-collapse text-[13px]">
        <caption className="px-4 pb-3 text-left text-[11.5px] text-ink-muted">
          Each line as a percentage of the same month&rsquo;s revenue. Months with no revenue
          are left out.
        </caption>
        <thead>
          <tr>
            <th scope="col" className={clsx(head, "text-left")}>
              Particulars
            </th>
            {shown.map((m) => (
              <th key={m.key} scope="col" className={clsx(head, "text-right")}>
                {m.label}
              </th>
            ))}
            <th scope="col" className={clsx(head, "border-l border-line text-right")}>
              Year to date
            </th>
            {budgetColumn && (
              <th scope="col" className={clsx(head, "text-right font-normal")}>
                Budget FY
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr
              key={line.code}
              className={clsx(
                line.isSubtotal ? "bg-surface-sunk font-semibold" : "hover:bg-surface-sunk/50",
              )}
            >
              <th
                scope="row"
                className={clsx(
                  "border-b border-line px-3 py-2 text-left text-ink",
                  line.isSubtotal ? "font-semibold" : "font-normal",
                )}
              >
                {line.name}
              </th>
              {shown.map((m) => (
                <td
                  key={m.key}
                  className="num border-b border-line px-3 py-2 text-right text-ink-muted"
                >
                  {cell(line.actual[m.key], revenue.actual[m.key])}
                </td>
              ))}
              <td className="num border-b border-l border-line px-3 py-2 text-right font-medium text-ink">
                {cell(
                  months.reduce((s, m) => s + line.actual[m.key], 0),
                  fyRevenue,
                )}
              </td>
              {budgetColumn && (
                <td className="num border-b border-line px-3 py-2 text-right text-ink-faint">
                  {cell(
                    months.reduce((s, m) => s + line.budget[m.key], 0),
                    fyBudgetRevenue,
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

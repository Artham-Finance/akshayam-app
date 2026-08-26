import clsx from "clsx";
import { money, percent } from "@/lib/format";
import type { BvaLine } from "@/lib/reports/budget-pnl";
import type { FyMonth } from "@/lib/period";

const sum = (values: Record<string, number>, months: FyMonth[]) =>
  months.reduce((total, m) => total + (values[m.key] ?? 0), 0);

/**
 * Budget against actual, down the statement.
 *
 * A cost line holds a positive magnitude, so "variance" has to mean the same
 * thing on every row: **better or worse than budget**. Spending less than
 * budget is favourable and earning less is not, and a table that showed both
 * as a plain subtraction would colour half of them the wrong way.
 */
export function BvaStatement({
  lines,
  months,
  periodMonths,
}: {
  lines: BvaLine[];
  months: FyMonth[];
  periodMonths: FyMonth[];
}) {
  const head =
    "border-y border-line px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-faint";

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
            {["Annual Budget", "Period Budget", "Actual", "Variance", "% Achievement"].map((h) => (
              <th key={h} scope="col" className={clsx(head, "text-right")}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => {
            const annual = sum(line.budget, months);
            const budget = sum(line.budget, periodMonths);
            const actual = sum(line.actual, periodMonths);
            // Costs are held positive, so under-spending is the favourable case.
            const variance = line.sign === -1 ? budget - actual : actual - budget;
            const achievement = budget === 0 ? null : (actual / budget) * 100;
            const favourable = variance >= -0.5;

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
                  {money(annual)}
                </td>
                <td className="num border-b border-line px-4 py-2 text-right text-ink-muted">
                  {money(budget)}
                </td>
                <td
                  className={clsx(
                    "num border-b border-line px-4 py-2 text-right font-medium",
                    actual < -0.5 ? "num-negative text-negative" : "text-ink",
                  )}
                >
                  {money(actual)}
                </td>
                <td
                  className={clsx(
                    "num border-b border-line px-4 py-2 text-right",
                    favourable ? "text-positive" : "num-negative text-negative",
                  )}
                >
                  {money(variance)}
                </td>
                <td
                  className={clsx(
                    "num border-b border-line px-4 py-2 text-right",
                    achievement === null
                      ? "text-ink-faint"
                      : favourable
                        ? "text-positive"
                        : "text-caution",
                  )}
                >
                  {achievement === null ? "—" : percent(achievement, 1)}
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

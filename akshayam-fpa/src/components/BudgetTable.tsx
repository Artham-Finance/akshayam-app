import clsx from "clsx";
import { Fragment } from "react";
import { money, percent } from "@/lib/format";
import type { BudgetCells, BudgetVsActual } from "@/lib/reports/budget";

/**
 * Budget against actual, by vertical.
 *
 * Laid out the way the firm already reads it: annual budget, the slice of it
 * the period earns, what came in, the gap, and the percentage. Shortfalls are
 * in accounting brackets and coloured, because on this table the sign is the
 * whole message - a variance that reads as a plain number gets skimmed past.
 *
 * When a week or month is picked, the same four columns appear twice - but the
 * *cumulative* set leads, because that is the one that answers the question the
 * report exists to answer. A week on its own says what happened; only the year
 * to date says whether the year is on track, and one quiet week reads like a
 * crisis without the run-rate in front of it. The single week follows, smaller.
 */
/** Column groups, cumulative first: it is the figure the report exists to give. */
const ORDER = (twin: boolean) =>
  twin ? (["cumulative", "period"] as const) : (["period"] as const);

export function BudgetTable({
  data,
  periodLabel,
  periodBasis,
  cumulativeBasis,
}: {
  data: BudgetVsActual;
  periodLabel: string;
  periodBasis: string;
  cumulativeBasis?: string | null;
}) {
  const rows = [...data.rows, data.total];
  const twin = data.cumulativeLabel !== null;
  /**
   * The fee split hangs off the leading group only. It is billed monthly, so a
   * single week has no share of it, and repeating it in both groups would
   * double the width for a figure that is the same either way.
   */
  const lead = twin ? "cumulative" : "period";
  const split = rows.some((r) => (lead === "period" ? r.period : r.cumulative)?.retainership !== null);
  const HEADS = (which: "period" | "cumulative") =>
    which === lead && split
      ? ["Period Budget", "Actual", "Professional fee", "Retainership fee", "Variance", "% Achievement"]
      : ["Period Budget", "Actual", "Variance", "% Achievement"];

  const groupHead = "border-y border-line px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-faint";

  const cellsFor = (row: (typeof rows)[number], which: "period" | "cumulative") =>
    which === "period" ? row.period : row.cumulative;

  /** The four figures of one window, rendered. */
  const group = (
    cells: BudgetCells | undefined,
    isTotal: boolean,
    leading: boolean,
    which: "period" | "cumulative",
  ) => {
    const muted = which === "period" && leading;
    if (!cells) return null;
    const short = cells.variance < -0.5;
    // Nothing budgeted and nothing earned is not an achievement of 0%, it is a
    // line with no target - say so rather than print a number.
    const pct =
      cells.achievement === null
        ? cells.actual === 0
          ? "—"
          : "no budget"
        : percent(cells.achievement, 2);

    const base = clsx("num border-b border-line px-4 py-2 text-right", muted && "opacity-70");
    const showSplit = which === lead && split;
    return (
      <Fragment key={which}>
        <td className={clsx(base, "text-ink-muted", leading && "border-l border-line")}>
          {money(cells.periodBudget)}
        </td>
        <td
          className={clsx(
            base,
            "font-medium",
            // A vertical can go negative for a period when a credit note
            // outweighs what it billed. Printed unsigned that reads as a good
            // month.
            cells.actual < -0.5 ? "num-negative text-negative" : "text-ink",
          )}
        >
          {money(cells.actual)}
        </td>
        {showSplit && (
          <td className={clsx(base, "text-ink-muted")}>
            {cells.professional === null ? "—" : money(cells.professional)}
          </td>
        )}
        {showSplit && (
          <td className={clsx(base, "text-ink-muted")}>
            {cells.retainership ? money(cells.retainership) : "—"}
          </td>
        )}
        <td className={clsx(base, short ? "num-negative text-negative" : "text-positive")}>
          {money(cells.variance)}
        </td>
        <td
          className={clsx(
            base,
            cells.achievement === null
              ? "text-ink-faint"
              : cells.achievement >= 100
                ? "text-positive"
                : cells.achievement >= 85
                  ? "text-ink"
                  : "text-caution",
            isTotal && "font-semibold",
          )}
        >
          {pct}
        </td>
      </Fragment>
    );
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max border-collapse text-[13px]">
        <caption className="px-4 pb-3 text-left text-[11.5px] text-ink-muted">
          Period budget is the annual budget × {twin ? cumulativeBasis : periodBasis}
          {twin ? `, and ${periodLabel} alone × ${periodBasis}` : ""}.
        </caption>
        <thead>
          {twin && (
            <tr>
              <th className={clsx(groupHead, "text-left")} />
              <th className={clsx(groupHead, "text-right")} />
              <th
                className={clsx(groupHead, "border-l border-line text-center")}
                colSpan={HEADS("cumulative").length}
              >
                {data.cumulativeLabel}
              </th>
              <th
                className={clsx(groupHead, "border-l border-line text-center font-normal")}
                colSpan={HEADS("period").length}
              >
                {periodLabel} alone
              </th>
            </tr>
          )}
          <tr>
            <th scope="col" className={clsx(groupHead, "text-left")}>
              Vertical
            </th>
            <th scope="col" className={clsx(groupHead, "text-right")}>
              Annual Budget
            </th>
            {ORDER(twin).flatMap((which) =>
              HEADS(which).map((header, i) => (
                <th
                  key={`${which}-${header}`}
                  scope="col"
                  className={clsx(
                    groupHead,
                    "text-right",
                    i === 0 && twin && "border-l border-line",
                    which === "period" && twin && "font-normal",
                  )}
                >
                  {which === "period" && twin && header === "Period Budget" ? "Budget" : header}
                </th>
              )),
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const isTotal = i === rows.length - 1;
            return (
              <tr
                key={row.code ?? row.name}
                className={clsx(isTotal ? "bg-surface-sunk font-semibold" : "hover:bg-surface-sunk/50")}
              >
                <th
                  scope="row"
                  className={clsx(
                    "border-b border-line px-4 py-2 text-left",
                    isTotal ? "font-semibold text-ink" : "font-normal text-ink",
                  )}
                >
                  {row.name}
                </th>
                <td className="num border-b border-line px-4 py-2 text-right text-ink-muted">
                  {money(row.annual)}
                </td>
                {ORDER(twin).map((which) => group(cellsFor(row, which), isTotal, twin, which))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

import clsx from "clsx";
import { moneySigned, percent } from "@/lib/format";

/**
 * What the statement's line budgets that its breakup does not itemise.
 *
 * The breakup cards under the statement (Team cost, Establishment cost,
 * Overheads) must add up to the line above them. When the breakup's own lines
 * fall short of, or run past, what the statement carries - the plan was
 * re-uploaded and a breakup behind it is out of date, or a line was never
 * itemised - the difference is shown as a row of its own rather than left as a
 * quiet gap between two totals that are meant to be one figure. Budget only:
 * actuals are never in it, so they still tie to the ledger.
 */
export interface Unitemised {
  periodBudget: number;
  ytdBudget: number;
}

/** The tolerance below which a difference is rounding, not a gap. */
const EPSILON = 1;

/** The difference, or null when the breakup already agrees with the statement. */
export function unitemisedGap(
  statement: { periodBudget: number; ytdBudget: number } | null,
  breakup: { periodBudget: number; ytdBudget: number },
): Unitemised | null {
  if (!statement) return null;
  const periodBudget = statement.periodBudget - breakup.periodBudget;
  const ytdBudget = statement.ytdBudget - breakup.ytdBudget;
  if (Math.abs(periodBudget) < EPSILON && Math.abs(ytdBudget) < EPSILON) return null;
  return { periodBudget, ytdBudget };
}

export const UNITEMISED_LABEL = "Not itemised in the plan";
export const UNITEMISED_HINT = "Budgeted on the statement's line, with no line of its own here";

export function UnitemisedRow({ gap, extraCells = 0 }: { gap: Unitemised; extraCells?: number }) {
  const cell = "border-b border-line px-3 py-2";
  return (
    <tr className="bg-caution-tint/40">
      <th scope="row" className={clsx(cell, "text-left font-normal text-ink")}>
        {UNITEMISED_LABEL}
        <span className="mt-0.5 block text-[11px] font-normal text-ink-faint">{UNITEMISED_HINT}</span>
      </th>
      <td className={clsx(cell, "num text-right text-ink-muted")}>{moneySigned(gap.periodBudget)}</td>
      <td className={clsx(cell, "num text-right text-ink-faint")}>—</td>
      <td className={clsx(cell, "num text-right text-ink-muted")}>{moneySigned(gap.ytdBudget)}</td>
      <td className={clsx(cell, "num text-right text-ink-faint")}>—</td>
      <td className={clsx(cell, "num text-right", gap.ytdBudget < 0 ? "text-negative" : "text-ink-muted")}>
        {moneySigned(gap.ytdBudget)}
      </td>
      <td className={clsx(cell, "num text-right text-ink-muted")}>
        {gap.ytdBudget ? percent(gap.ytdBudget > 0 ? 100 : -100) : "—"}
      </td>
      {Array.from({ length: extraCells }, (_, i) => (
        <td key={i} className={cell} />
      ))}
    </tr>
  );
}

/** A breakup's footer totals with the unitemised budget added back in. */
export function withUnitemised(
  totals: {
    periodBudget: number;
    ytdBudget: number;
    ytdActual: number;
  },
  gap: Unitemised | null,
) {
  const periodBudget = totals.periodBudget + (gap?.periodBudget ?? 0);
  const ytdBudget = totals.ytdBudget + (gap?.ytdBudget ?? 0);
  const ytdVariance = ytdBudget - totals.ytdActual;
  return {
    periodBudget,
    ytdBudget,
    ytdVariance,
    ytdVariancePct: ytdBudget ? (ytdVariance / ytdBudget) * 100 : null,
  };
}

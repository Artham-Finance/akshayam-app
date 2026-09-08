"use client";

import { Fragment, useState } from "react";
import clsx from "clsx";
import { compactINR, money, percent } from "@/lib/format";
import { BASIS_LABEL, HEAD_BASIS } from "@/lib/reports/apportionment-rules";
import type { ScorecardRow } from "@/lib/reports/scorecard";

/**
 * A team lead's own net revenue contribution, exactly as the Vertical
 * Performance Scorecard strikes it: ledger revenue, less the vertical's own
 * direct cost, less its apportioned share of the common pool.
 *
 * The numbers are the scorecard's - same builder, same cumulative-quarter
 * window - so the two pages can never disagree. The apportioned-cost cell opens
 * to the head-by-head workings, which sum back to that figure.
 */
export function VerticalContributionCard({
  rows,
  firmTotals,
  apportionedByHead,
}: {
  rows: ScorecardRow[];
  firmTotals: {
    revenue: number;
    directCost: number;
    apportionedCost: number;
    contribution: number;
  };
  /** head -> amount, folded over the same quarters, for the drill-down */
  apportionedByHead: Record<string, number>;
}) {
  const [openApport, setOpenApport] = useState(false);
  const basisFor = (h: string) =>
    HEAD_BASIS[h] ? BASIS_LABEL[HEAD_BASIS[h]] : "—";

  const head =
    "border-y border-line px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-faint";
  const cell = "border-b border-line px-3 py-2";
  const headRows = Object.entries(apportionedByHead).filter(([, v]) => Math.abs(v) > 0.5);
  const canOpen = headRows.length > 0;

  // Out-of-books billing for the shown vertical(s): in the P&L statement above,
  // but not here - it has no cost line, so folding it in would overstate
  // contribution. Named so the two revenue figures visibly reconcile.
  const outOfBooks = rows.reduce(
    (s, r) => s + Math.max(0, r.revenueActual - r.contributionRevenue),
    0,
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max border-collapse text-[13px]">
        <caption className="px-4 pb-3 text-left text-[11.5px] text-ink-muted">
          The same figures as the Net revenue contribution card on the Vertical
          Performance Scorecard. Revenue is the ledger&rsquo;s; contribution is
          struck after the vertical&rsquo;s own direct cost and its apportioned
          share of common cost. The footer is the whole firm, as a benchmark.
        </caption>
        <thead>
          <tr>
            <th scope="col" className={clsx(head, "text-left")}>
              Vertical
            </th>
            <th scope="col" className={clsx(head, "text-right")}>
              Revenue
            </th>
            <th scope="col" className={clsx(head, "text-right")}>
              Direct cost
            </th>
            <th scope="col" className={clsx(head, "text-right")}>
              Apportioned cost
            </th>
            <th scope="col" className={clsx(head, "text-right")}>
              Contribution
            </th>
            <th scope="col" className={clsx(head, "text-right")}>
              % of total
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Fragment key={r.code}>
              <tr className="hover:bg-surface-sunk/40">
                <th scope="row" className={clsx(cell, "text-left font-normal text-ink")}>
                  {r.label}
                </th>
                <td className={clsx(cell, "num text-right text-ink")}>
                  {money(r.contributionRevenue)}
                </td>
                <td className={clsx(cell, "num text-right text-ink")}>{money(r.directCost)}</td>
                <td className={clsx(cell, "num text-right text-ink")}>
                  {canOpen ? (
                    <button
                      type="button"
                      onClick={() => setOpenApport((v) => !v)}
                      aria-expanded={openApport}
                      className="inline-flex items-center gap-1 hover:text-navy"
                    >
                      <span
                        className={clsx(
                          "text-[9px] text-ink-faint transition-transform",
                          openApport && "rotate-90",
                        )}
                      >
                        ▶
                      </span>
                      {money(r.apportionedCost)}
                    </button>
                  ) : (
                    money(r.apportionedCost)
                  )}
                </td>
                <td
                  className={clsx(
                    cell,
                    "num text-right",
                    r.revenueContribution < 0 ? "text-negative" : "text-ink",
                  )}
                >
                  {money(r.revenueContribution)}
                </td>
                <td className={clsx(cell, "num text-right text-ink-muted")}>
                  {r.revenueContributionShare === null
                    ? "—"
                    : percent(r.revenueContributionShare * 100, 1)}
                </td>
              </tr>
              {openApport && canOpen && (
                <tr>
                  <td colSpan={6} className="border-b border-line bg-surface-sunk/30 px-3 py-3 sm:px-6">
                    <table className="w-full border-collapse text-[12px]">
                      <thead>
                        <tr className="text-ink-faint">
                          <th className="px-2 py-1 text-left font-medium">Head of common cost</th>
                          <th className="px-2 py-1 text-left font-medium">Spread on</th>
                          <th className="px-2 py-1 text-right font-medium">Charged to this vertical</th>
                        </tr>
                      </thead>
                      <tbody>
                        {headRows.map(([h, v]) => (
                          <tr key={h} className="text-ink">
                            <td className="border-t border-line px-2 py-1.5">{h}</td>
                            <td className="border-t border-line px-2 py-1.5 text-ink-muted">
                              {basisFor(h)}
                            </td>
                            <td className="num border-t border-line px-2 py-1.5 text-right font-medium">
                              {money(v)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="font-semibold text-ink">
                          <td className="border-t-line-strong px-2 py-1.5" colSpan={2}>
                            Apportioned cost
                          </td>
                          <td className="num border-t-line-strong px-2 py-1.5 text-right">
                            {money(r.apportionedCost)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-surface-sunk font-semibold">
            <th scope="row" className="border-y border-line-strong px-3 py-2 text-left">
              Firm total
            </th>
            <td className="num border-y border-line-strong px-3 py-2 text-right">
              {compactINR(firmTotals.revenue)}
            </td>
            <td className="num border-y border-line-strong px-3 py-2 text-right">
              {compactINR(firmTotals.directCost)}
            </td>
            <td className="num border-y border-line-strong px-3 py-2 text-right">
              {compactINR(firmTotals.apportionedCost)}
            </td>
            <td className="num border-y border-line-strong px-3 py-2 text-right">
              {compactINR(firmTotals.contribution)}
            </td>
            <td className="num border-y border-line-strong px-3 py-2 text-right">
              {percent(100, 0)}
            </td>
          </tr>
        </tfoot>
      </table>
      {outOfBooks > 0.5 && (
        <p className="border-t border-line px-4 py-3 text-[11.5px] leading-relaxed text-ink-muted sm:px-5">
          A further <span className="num font-medium">{money(outOfBooks)}</span> of
          out-of-books billing for this vertical is in the Profit &amp; Loss statement
          above but left out here — it carries no cost, so counting it would overstate
          contribution.
        </p>
      )}
    </div>
  );
}

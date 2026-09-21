"use client";

import { useState } from "react";
import clsx from "clsx";
import { dateLabel, money, moneySigned, percent } from "@/lib/format";
import type { EstablishmentLine, EstablishmentResult } from "@/lib/reports/establishment-detail";

/**
 * The breakdown behind Establishment cost - rent, office upkeep, electricity -
 * budget against actual, with the ledger postings behind each line.
 *
 * Read-only: the budget split is the office schedule the partners agreed, and
 * the actual is read straight from the ledger's establishment-cost accounts, so
 * there is nothing to enter here. The card total ties to the Establishment cost
 * line on the statement above. Open a line for the postings that make it up.
 */
export function EstablishmentCostTable({
  result,
  periodLabel,
  ytdLabel,
  caption,
  totalLabel = "Establishment cost",
}: {
  result: EstablishmentResult;
  /** short label for the period columns, e.g. "This month" or "Jul 26" */
  periodLabel: string;
  /** short label for the YTD columns, e.g. "to 27 Aug 26" */
  ytdLabel: string;
  /** the table's own explanatory line - defaults to the establishment-cost wording */
  caption?: string;
  /** the footer row's label - defaults to "Establishment cost" */
  totalLabel?: string;
}) {
  const [open, setOpen] = useState<string | null>(null);

  const head =
    "border-y border-line px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-faint";
  const subhead = "mt-0.5 block text-[10px] font-normal normal-case tracking-normal text-ink-faint";
  const { totals } = result;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max border-collapse text-[13px]">
        <caption className="px-4 pb-3 text-left text-[11.5px] text-ink-muted">
          {caption ?? (
            <>
              Budget is the office schedule, spread evenly. Actual is the
              establishment-cost postings in the ledger — rent, building maintenance
              and electricity — so the total ties to the statement above. Open a line
              for the postings behind it.
            </>
          )}
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
          {result.lines.map((line) => (
            <EstablishmentRow
              key={line.label}
              line={line}
              open={open === line.label}
              onToggle={() =>
                setOpen((cur) => (cur === line.label ? null : line.label))
              }
            />
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-surface-sunk font-semibold">
            <th scope="row" className="border-y border-line-strong px-3 py-2 text-left">
              {totalLabel}
            </th>
            <td className="num border-y border-line-strong px-3 py-2 text-right">
              {money(totals.periodBudget)}
            </td>
            <td className="num border-y border-line-strong px-3 py-2 text-right">
              {money(totals.periodActual)}
            </td>
            <td className="num border-y border-line-strong px-3 py-2 text-right">
              {money(totals.ytdBudget)}
            </td>
            <td className="num border-y border-line-strong px-3 py-2 text-right">
              {money(totals.ytdActual)}
            </td>
            <td
              className={clsx(
                "num border-y border-line-strong px-3 py-2 text-right",
                totals.ytdVariance < 0 ? "text-negative" : "text-positive",
              )}
            >
              {moneySigned(totals.ytdVariance)}
            </td>
            <td
              className={clsx(
                "num border-y border-line-strong px-3 py-2 text-right",
                totals.ytdVariancePct !== null && totals.ytdVariancePct < 0
                  ? "text-negative"
                  : "text-positive",
              )}
            >
              {totals.ytdVariancePct === null ? "—" : percent(totals.ytdVariancePct)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function EstablishmentRow({
  line,
  open,
  onToggle,
}: {
  line: EstablishmentLine;
  open: boolean;
  onToggle: () => void;
}) {
  const cell = "border-b border-line px-3 py-2";
  const canOpen = line.entries.length > 0;

  return (
    <>
      <tr className="hover:bg-surface-sunk/40">
        <th scope="row" className={clsx(cell, "text-left font-normal text-ink")}>
          <button
            type="button"
            onClick={onToggle}
            disabled={!canOpen}
            aria-expanded={open}
            className={clsx(
              "flex items-start gap-1.5 text-left",
              canOpen ? "hover:text-navy" : "cursor-default",
            )}
          >
            <span
              className={clsx(
                "mt-[3px] text-[9px] text-ink-faint transition-transform",
                open && "rotate-90",
                !canOpen && "opacity-0",
              )}
            >
              ▶
            </span>
            <span>
              {line.label}
              {canOpen && (
                <span className="ml-2 text-[11px] font-normal text-ink-faint">
                  {line.entries.length} posting{line.entries.length === 1 ? "" : "s"}
                </span>
              )}
            </span>
          </button>
        </th>
        <td
          className={clsx(cell, "num text-right", line.isActualOnly ? "text-ink-faint" : "text-ink-muted")}
        >
          {line.isActualOnly ? "—" : money(line.periodBudget)}
        </td>
        <td className={clsx(cell, "num text-right text-ink")}>
          {line.periodActual ? money(line.periodActual) : "—"}
        </td>
        <td
          className={clsx(cell, "num text-right", line.isActualOnly ? "text-ink-faint" : "text-ink-muted")}
        >
          {line.isActualOnly ? "—" : money(line.ytdBudget)}
        </td>
        <td className={clsx(cell, "num text-right text-ink")}>
          {line.ytdActual ? money(line.ytdActual) : "—"}
        </td>
        <td
          className={clsx(
            cell,
            "num text-right",
            line.isActualOnly
              ? "text-ink-faint"
              : line.ytdVariance < 0
                ? "text-negative"
                : "text-ink-muted",
          )}
        >
          {line.isActualOnly ? "—" : moneySigned(line.ytdVariance)}
        </td>
        <td
          className={clsx(
            cell,
            "num text-right",
            line.ytdVariancePct !== null && line.ytdVariancePct < 0
              ? "text-negative"
              : "text-ink-muted",
          )}
        >
          {line.ytdVariancePct === null ? "—" : percent(line.ytdVariancePct)}
        </td>
      </tr>

      {open && canOpen && (
        <tr>
          <td colSpan={7} className="border-b border-line bg-surface-sunk/30 px-3 py-3 sm:px-6">
            <DrillTable line={line} />
          </td>
        </tr>
      )}
    </>
  );
}

function DrillTable({ line }: { line: EstablishmentLine }) {
  const cell = "border-t border-line px-2 py-1.5";

  return (
    <table className="w-full border-collapse text-[12px]">
      <thead>
        <tr className="text-ink-faint">
          <th scope="col" className="px-2 py-1 text-left font-medium">Date</th>
          <th scope="col" className="px-2 py-1 text-left font-medium">Particulars</th>
          <th scope="col" className="px-2 py-1 text-left font-medium">Description</th>
          <th scope="col" className="px-2 py-1 text-right font-medium">Amount</th>
        </tr>
      </thead>
      <tbody>
        {line.entries.map((e, i) => (
          <tr key={i} className="text-ink">
            <td className={clsx(cell, "num whitespace-nowrap text-ink-muted")}>
              {dateLabel(e.date)}
            </td>
            <td className={cell}>{e.particulars}</td>
            <td className={clsx(cell, "text-ink-muted")}>{e.description || "—"}</td>
            <td className={clsx(cell, "num text-right font-medium")}>{money(e.amount)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="font-semibold text-ink">
          <td className={clsx(cell, "border-t-line-strong")} colSpan={3}>
            {line.entries.length} posting{line.entries.length === 1 ? "" : "s"}
          </td>
          <td className={clsx(cell, "num border-t-line-strong text-right")}>
            {money(line.periodActual)}
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

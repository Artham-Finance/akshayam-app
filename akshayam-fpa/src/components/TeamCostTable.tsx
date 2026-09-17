"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import { dateLabel, money, moneySigned, percent } from "@/lib/format";
import type {
  TeamCostResult,
  TeamCostRoleLine,
  TeamCostScope,
} from "@/lib/reports/team-cost";

/**
 * Team cost by role, with a vertical picker and a drill-down on every line.
 *
 * The budget is hard-coded (see src/lib/reports/team-cost.ts). The actual is
 * read straight from the general ledger - every direct_cost entry carries a
 * vertical tag - so nothing here is entered by hand. Opening a line shows the
 * ledger postings that make up its actual.
 *
 * One scope shows at a time: the whole company by default, or a vertical from
 * the picker.
 */

export function TeamCostTable({
  result,
  periodLabel,
  ytdLabel,
}: {
  result: TeamCostResult;
  /** short label for the period columns, e.g. "This month" or "Jul 26" */
  periodLabel: string;
  /** short label for the YTD columns, e.g. "to 27 Aug 26" */
  ytdLabel: string;
}) {
  const [scopeCode, setScopeCode] = useState("ALL");
  const [open, setOpen] = useState<string | null>(null);

  const scope: TeamCostScope = useMemo(() => {
    if (scopeCode === "ALL") return result.company;
    return result.verticals.find((v) => v.code === scopeCode) ?? result.company;
  }, [scopeCode, result]);

  const isCompany = scope.verticalId === null;
  const head =
    "border-y border-line px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-faint";
  const subhead = "mt-0.5 block text-[10px] font-normal normal-case tracking-normal text-ink-faint";

  return (
    <div className="overflow-x-auto">
      <div className="flex flex-wrap items-center gap-2 px-4 pb-3 sm:px-5">
        <label className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-faint">
          Vertical
        </label>
        <select
          value={scopeCode}
          onChange={(e) => {
            setScopeCode(e.target.value);
            setOpen(null);
          }}
          className="rounded-md border border-line bg-surface px-2 py-1 text-[12px] text-ink outline-none focus:border-navy"
        >
          <option value="ALL">Whole company</option>
          {result.verticals.map((v) => (
            <option key={v.code} value={v.code}>
              {v.name}
            </option>
          ))}
        </select>
        <span className="text-[11.5px] text-ink-muted">
          Budget hard-coded from the plan; actuals are the vertical-tagged
          direct-cost postings in the ledger. Open a line for the postings behind
          it.
        </span>
      </div>

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
          {scope.roles.map((line) => (
            <RoleRow
              key={line.role}
              line={line}
              showVertical={isCompany}
              open={open === line.role}
              onToggle={() =>
                setOpen((cur) => (cur === line.role ? null : line.role))
              }
            />
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-surface-sunk font-semibold">
            <th scope="row" className="border-y border-line-strong px-3 py-2 text-left">
              Team cost — {scope.name}
            </th>
            <td className="num border-y border-line-strong px-3 py-2 text-right">
              {money(scope.periodBudget)}
            </td>
            <td className="num border-y border-line-strong px-3 py-2 text-right">
              {money(scope.periodActual)}
            </td>
            <td className="num border-y border-line-strong px-3 py-2 text-right">
              {money(scope.ytdBudget)}
            </td>
            <td className="num border-y border-line-strong px-3 py-2 text-right">
              {money(scope.ytdActual)}
            </td>
            <td
              className={clsx(
                "num border-y border-line-strong px-3 py-2 text-right",
                scope.ytdVariance < 0 ? "text-negative" : "text-positive",
              )}
            >
              {moneySigned(scope.ytdVariance)}
            </td>
            <td
              className={clsx(
                "num border-y border-line-strong px-3 py-2 text-right",
                scope.ytdVariancePct !== null && scope.ytdVariancePct < 0
                  ? "text-negative"
                  : "text-positive",
              )}
            >
              {scope.ytdVariancePct === null ? "—" : percent(scope.ytdVariancePct)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function RoleRow({
  line,
  showVertical,
  open,
  onToggle,
}: {
  line: TeamCostRoleLine;
  showVertical: boolean;
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
              {line.hint && (
                <span className="mt-0.5 block text-[11px] font-normal text-ink-faint">
                  {line.hint}
                </span>
              )}
            </span>
          </button>
        </th>
        <td className={clsx(cell, "num text-right text-ink-muted")}>
          {money(line.periodBudget)}
        </td>
        <td className={clsx(cell, "num text-right text-ink")}>
          {line.periodActual ? money(line.periodActual) : "—"}
        </td>
        <td className={clsx(cell, "num text-right text-ink-muted")}>{money(line.ytdBudget)}</td>
        <td className={clsx(cell, "num text-right text-ink")}>
          {line.ytdActual ? money(line.ytdActual) : "—"}
        </td>
        <td
          className={clsx(
            cell,
            "num text-right",
            line.ytdVariance < 0 ? "text-negative" : "text-ink-muted",
          )}
        >
          {moneySigned(line.ytdVariance)}
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
            <DrillTable line={line} showVertical={showVertical} />
          </td>
        </tr>
      )}
    </>
  );
}

function DrillTable({
  line,
  showVertical,
}: {
  line: TeamCostRoleLine;
  showVertical: boolean;
}) {
  const cell = "border-t border-line px-2 py-1.5";

  return (
    <table className="w-full border-collapse text-[12px]">
      <thead>
        <tr className="text-ink-faint">
          <th scope="col" className="px-2 py-1 text-left font-medium">Date</th>
          <th scope="col" className="px-2 py-1 text-left font-medium">Particulars</th>
          <th scope="col" className="px-2 py-1 text-left font-medium">Description</th>
          {showVertical && (
            <th scope="col" className="px-2 py-1 text-left font-medium">Vertical</th>
          )}
          <th scope="col" className="px-2 py-1 text-right font-medium">Amount</th>
        </tr>
      </thead>
      <tbody>
        {line.entries.map((e, i) => (
          <tr key={i} className="text-ink">
            <td className={clsx(cell, "num whitespace-nowrap text-ink-muted")}>
              {dateLabel(e.date)}
            </td>
            <td className={cell}>
              {e.description}
              {e.account && (
                <span className="ml-1.5 text-[11px] text-ink-faint">({e.account})</span>
              )}
            </td>
            <td className={clsx(cell, "text-ink-muted")}>{e.reference || "—"}</td>
            {showVertical && (
              <td className={clsx(cell, "text-ink-muted")}>{e.verticalCode}</td>
            )}
            <td className={clsx(cell, "num text-right font-medium")}>{money(e.amount)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="font-semibold text-ink">
          <td className={clsx(cell, "border-t-line-strong")} colSpan={showVertical ? 4 : 3}>
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

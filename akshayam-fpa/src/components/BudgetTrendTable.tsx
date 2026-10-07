"use client";

import { Fragment, useState } from "react";
import clsx from "clsx";
import { money, percent } from "@/lib/format";
import type { BudgetTrend, TrendCells, TrendMonthRow } from "@/lib/reports/budget-trend";

/**
 * A measure's year, on one schedule: year to date and quarter to date up
 * top, then the four quarters each opening onto their own three months -
 * the same shape a partner already reads the annual plan in, just struck
 * against what actually happened. Used for both revenue and collections.
 */
export function BudgetTrendTable({ trend }: { trend: BudgetTrend }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (key: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const head =
    "border-y border-line px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-faint";
  const cell = "num border-b border-line px-3 py-2 text-right";

  const cellsFor = (c: TrendCells, tone: "muted" | "strong" = "muted") => (
    <>
      <td className={clsx(cell, "text-ink-muted")}>{money(c.budget)}</td>
      <td className={clsx(cell, tone === "strong" ? "font-medium text-ink" : "text-ink")}>
        {money(c.actual)}
      </td>
      <td
        className={clsx(
          cell,
          c.variance >= -0.5 ? "text-positive" : "num-negative text-negative",
        )}
      >
        {money(c.variance)}
      </td>
      <td
        className={clsx(
          cell,
          c.achievement === null
            ? "text-ink-faint"
            : c.achievement >= 100
              ? "text-positive"
              : "text-caution",
        )}
      >
        {c.achievement === null ? "—" : percent(c.achievement, 1)}
      </td>
    </>
  );

  const monthRow = (m: TrendMonthRow) => (
    <tr key={m.key} className="hover:bg-surface-sunk/40">
      <th scope="row" className="border-b border-line px-3 py-2 pl-8 text-left font-normal text-ink-muted">
        {m.label}
      </th>
      {cellsFor(m.cells)}
    </tr>
  );

  const groupRow = (
    key: string,
    label: string,
    cells: TrendCells,
    months: TrendMonthRow[],
  ) => {
    const isOpen = open.has(key);
    return (
      <Fragment key={key}>
        <tr className="hover:bg-surface-sunk/50">
          <th scope="row" className="border-b border-line px-3 py-2 text-left font-semibold text-ink">
            <button
              type="button"
              onClick={() => toggle(key)}
              disabled={months.length === 0}
              aria-expanded={isOpen}
              className={clsx(
                "flex items-center gap-1.5",
                months.length > 0 ? "hover:text-navy" : "cursor-default",
              )}
            >
              <span
                className={clsx(
                  "text-[9px] text-ink-faint transition-transform",
                  isOpen && "rotate-90",
                  months.length === 0 && "opacity-0",
                )}
              >
                ▶
              </span>
              {label}
            </button>
          </th>
          {cellsFor(cells, "strong")}
        </tr>
        {isOpen && months.map((m) => monthRow(m))}
      </Fragment>
    );
  };

  return (
    <div className="table-frame">
      <div className="flex justify-end gap-2 px-3 pb-2 pt-3 text-[11.5px]">
        <button
          type="button"
          onClick={() => setOpen(new Set(["qtd", ...trend.quarters.map((q) => q.label)]))}
          className="text-ink-muted hover:text-navy"
        >
          Expand all
        </button>
        <span className="text-ink-faint">·</span>
        <button type="button" onClick={() => setOpen(new Set())} className="text-ink-muted hover:text-navy">
          Collapse all
        </button>
      </div>
      <table className="w-full min-w-max border-collapse text-[13px]">
        <thead>
          <tr>
            <th scope="col" className={clsx(head, "text-left")}>
              Particulars
            </th>
            <th scope="col" className={clsx(head, "text-right")}>
              Budget
            </th>
            <th scope="col" className={clsx(head, "text-right")}>
              Actual
            </th>
            <th scope="col" className={clsx(head, "text-right")}>
              Variance
            </th>
            <th scope="col" className={clsx(head, "text-right")}>
              % achievement
            </th>
          </tr>
        </thead>
        <tbody>
          <tr className="bg-surface-sunk font-semibold hover:bg-surface-sunk">
            <th scope="row" className="border-b border-line px-3 py-2 text-left text-ink">
              Year to date
            </th>
            {cellsFor(trend.ytd, "strong")}
          </tr>
          {groupRow("qtd", trend.qtd.label, trend.qtd.cells, trend.qtd.months)}
          {trend.quarters.map((q) => groupRow(q.label, q.label, q.cells, q.months))}
        </tbody>
      </table>
    </div>
  );
}

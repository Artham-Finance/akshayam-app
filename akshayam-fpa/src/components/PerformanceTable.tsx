import clsx from "clsx";
import { growth, moneySigned, share } from "@/lib/format";
import type { PerformanceColumn, PerformanceFigures } from "@/lib/reports/performance-trend";

/**
 * One column per financial year, the selected year last. Under each figure sits its change on
 * the year before; under each column's heading, how many of the period's months it has and
 * where they came from, so a half-finished period is never mistaken for a finished one.
 */

type Row = {
  key: keyof PerformanceFigures;
  label: string;
  /** a rise in this line is good news (profit) or bad (cost) - for the colour of the change */
  good: "up" | "down";
  emphasis?: boolean;
  note?: string;
  /** a percentage change on a small net line is noise, so it is not shown */
  noChange?: boolean;
};

export function PerformanceTable({
  columns,
  selectedFy,
  taxRate,
}: {
  columns: PerformanceColumn[];
  selectedFy: number;
  taxRate: number;
}) {
  const rows: Row[] = [
    { key: "revenue", label: "Revenue", good: "up", emphasis: true },
    { key: "expenses", label: "Expenses", good: "down" },
    {
      key: "other",
      label: "Other income & reimbursements (net)",
      good: "up",
      noChange: true,
      note: "Interest and other income, reimbursements recovered net of what was spent, and non-operating items",
    },
    { key: "pbt", label: "Profit before tax", good: "up", emphasis: true },
    { key: "tax", label: `Tax @ ${taxRate}%`, good: "down" },
    { key: "pat", label: "Profit after tax", good: "up", emphasis: true },
  ];

  const head =
    "border-y border-line px-2 py-2 text-right text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-faint";
  const cell = "num border-b border-line px-2 py-2 text-right align-top";

  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed border-collapse text-[13px]">
        <thead>
          <tr>
            <th className={clsx(head, "w-[30%] text-left")}>&nbsp;</th>
            {columns.map((c) => (
              <th key={c.fyStartYear} className={clsx(head, c.fyStartYear === selectedFy && "bg-navy-tint text-navy")}>
                <div>{c.label}</div>
                <div className="mt-0.5 text-[10.5px] font-normal normal-case tracking-normal">
                  {c.monthsWithData === 0
                    ? "no figures"
                    : c.monthsWithData === c.monthLabels.length
                      ? `${c.monthsWithData} of ${c.monthLabels.length} month${c.monthLabels.length === 1 ? "" : "s"}`
                      : `${c.monthsWithData} of ${c.monthLabels.length} months only`}
                  {c.sources.length > 0 && (
                    <span> · {c.sources.map((s) => (s === "uploaded" ? "uploaded P&L" : "ledger")).join(" + ")}</span>
                  )}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className={row.emphasis ? "bg-surface-sunk/50 font-semibold" : undefined}>
              <th scope="row" className="border-b border-line px-2 py-2 text-left font-[inherit]">
                {row.label}
                {row.note && <div className="text-[10.5px] font-normal text-ink-faint">{row.note}</div>}
              </th>
              {columns.map((c, i) => {
                const value = c.figures?.[row.key] ?? null;
                const prior = i > 0 ? (columns[i - 1].figures?.[row.key] ?? null) : null;
                const change = !row.noChange && value !== null && prior !== null ? growth(value, prior) : null;
                const goodNews = change === null ? null : row.good === "up" ? change >= 0 : change <= 0;
                return (
                  <td key={c.fyStartYear} className={clsx(cell, c.fyStartYear === selectedFy && "bg-navy-tint/40")}>
                    {value === null ? (
                      <span className="text-ink-faint">-</span>
                    ) : (
                      <>
                        {moneySigned(value)}
                        {change !== null && (
                          <div
                            className={clsx(
                              "text-[10.5px] font-normal",
                              goodNews ? "text-positive" : "text-negative",
                            )}
                          >
                            {change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(1)}%
                          </div>
                        )}
                      </>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
          <tr>
            <th scope="row" className="px-3 py-2 text-left text-[12px] font-normal text-ink-muted">
              Profit before tax, % of revenue
            </th>
            {columns.map((c) => {
              const m = c.figures ? share(c.figures.pbt, c.figures.revenue) : null;
              return (
                <td key={c.fyStartYear} className="num px-3 py-2 text-right text-[12px] text-ink-muted">
                  {m === null ? "-" : `${m.toFixed(1)}%`}
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

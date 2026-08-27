import clsx from "clsx";
import type { ReactNode } from "react";
import { dateLabel, money } from "@/lib/format";

export interface Column {
  header: string;
  /** right-align and use tabular numerals */
  numeric?: boolean;
  /** render with extra weight, e.g. a total column */
  strong?: boolean;
}

/** Render a drill-down's typed cells for reading on screen. */
export function drillColumns(
  columns: { header: string; type: string; strong?: boolean }[],
): Column[] {
  return columns.map((c) => ({
    header: c.header,
    numeric: c.type === "money" || c.type === "days" || c.type === "percent",
    strong: c.strong,
  }));
}

/**
 * A drill-down row, formatted for reading.
 *
 * Rupee figures are whole, except where rounding would print a real amount as
 * "0" - a 33-paise unapplied balance is not none, and saying so matters on a
 * screen whose whole purpose is tracing a figure to its documents.
 */
export function renderDrillRow(
  row: (string | number | null)[],
  columns: { type: string }[],
): ReactNode[] {
  return row.map((value, i) => {
    if (value === null || value === "") return "—";
    const type = columns[i]?.type;
    if (type === "date") return dateLabel(String(value));
    if (type === "days") return `${value}d`;
    if (type === "percent") return `${Number(value).toFixed(2)}%`;
    if (type === "money") {
      const n = Number(value);
      return money(n, Number.isInteger(n) || Math.abs(n) >= 1 ? 0 : 2);
    }
    return String(value);
  });
}

/**
 * Plain listing table. Figures right-aligned with tabular numerals so columns
 * line up; the first column is the label and stays left.
 */
export function DataTable({
  columns,
  rows,
  emptyMessage = "Nothing to show for this period.",
  footer,
}: {
  columns: Column[];
  rows: ReactNode[][];
  emptyMessage?: string;
  footer?: ReactNode[];
}) {
  if (rows.length === 0) {
    return <p className="px-4 py-6 text-center text-[13px] text-ink-muted">{emptyMessage}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max border-collapse text-[13px]">
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.header}
                scope="col"
                className={clsx(
                  "border-y border-line px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-faint",
                  col.numeric ? "text-right" : "text-left",
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="hover:bg-surface-sunk/50">
              {row.map((cell, j) => (
                <td
                  key={j}
                  className={clsx(
                    "border-b border-line px-4 py-2",
                    columns[j]?.numeric ? "num text-right" : "text-left",
                    columns[j]?.strong ? "font-medium text-ink" : "text-ink-muted",
                    j === 0 && "text-ink",
                  )}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer && (
          <tfoot>
            <tr>
              {footer.map((cell, j) => (
                <td
                  key={j}
                  className={clsx(
                    "border-t border-line-strong px-4 py-2 font-semibold text-ink",
                    columns[j]?.numeric ? "num text-right" : "text-left",
                  )}
                >
                  {cell}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

/** Horizontal proportion bar used in the by-month and ageing views. */
export function Bar({
  segments,
  max,
}: {
  segments: { value: number; className: string; label: string }[];
  max: number;
}) {
  return (
    <div className="flex h-5 flex-1 overflow-hidden rounded-sm bg-surface-sunk">
      {segments.map((s, i) => (
        <div
          key={i}
          className={s.className}
          style={{ width: `${max > 0 ? (s.value / max) * 100 : 0}%` }}
          title={s.label}
        />
      ))}
    </div>
  );
}

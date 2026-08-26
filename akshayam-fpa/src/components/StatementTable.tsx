"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import { money, scaled, scaleLabel, type Scale } from "@/lib/format";
import { groupByQuarter, quarterLabel, type FyMonth, type QuarterNo } from "@/lib/period";

/**
 * The statement grid.
 *
 * Columns are quarters by default; clicking a quarter header expands it into
 * its three months plus a quarter total. All of that is arithmetic on the
 * monthly figures already in the browser, so expanding is instant.
 *
 * Rows work the same way: a group heading carries the total and can be opened
 * to show the ledger accounts beneath it.
 */

export interface ClientLine {
  key: string;
  name: string;
  level: number;
  isSubtotal: boolean;
  sign: number;
  groupCode: string | null;
  accountId: number | null;
  values: Record<string, number>;
  /** overrides the table's own setting, for a position line inside a flow statement */
  columnAggregate?: "sum" | "first" | "last";
}

interface Column {
  key: string;
  label: string;
  /** the months this column covers, in order */
  months: string[];
  kind: "month" | "quarter" | "total";
  quarter?: QuarterNo;
  /** first column of an expanded quarter, used for the group separator rule */
  startsGroup?: boolean;
}

export function StatementTable({
  months,
  lines,
  emphasise = [],
  initialScale = "lakhs",
  aggregate = "sum",
  drillHref,
}: {
  months: FyMonth[];
  lines: ClientLine[];
  /** group codes to render with extra weight, e.g. EBITDA and PAT */
  emphasise?: string[];
  initialScale?: Scale;
  /**
   * How a quarter or year column combines its months.
   *   sum      P&L: three months of trading add up
   *   closing  balance sheet: a position at a point in time does not add up,
   *            so the column shows where the balance stood at the end of it
   */
  aggregate?: "sum" | "closing";
  /** builds a link for a detail row, when drill-down is available */
  drillHref?: (line: ClientLine, monthKeys: string[]) => string | null;
}) {
  const [expandedQuarters, setExpandedQuarters] = useState<Set<QuarterNo>>(new Set());
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [scale, setScale] = useState<Scale>(initialScale);
  const [showAllDetail, setShowAllDetail] = useState(false);

  const quarters = useMemo(() => groupByQuarter(months), [months]);

  const columns = useMemo<Column[]>(() => {
    const cols: Column[] = [];
    for (const { quarter, months: qMonths } of quarters) {
      if (expandedQuarters.has(quarter)) {
        qMonths.forEach((m, i) => {
          cols.push({
            key: m.key,
            label: m.label,
            months: [m.key],
            kind: "month",
            quarter,
            startsGroup: i === 0,
          });
        });
        cols.push({
          key: `q${quarter}-total`,
          label: aggregate === "closing" ? `Q${quarter} Close` : `Q${quarter} Total`,
          months: qMonths.map((m) => m.key),
          kind: "quarter",
          quarter,
        });
      } else {
        cols.push({
          key: `q${quarter}`,
          label: quarterLabel(quarter, months),
          months: qMonths.map((m) => m.key),
          kind: "quarter",
          quarter,
          startsGroup: true,
        });
      }
    }
    cols.push({
      key: "fy-total",
      label: aggregate === "closing" ? "Year end" : "FY Total",
      months: months.map((m) => m.key),
      kind: "total",
      startsGroup: true,
    });
    return cols;
  }, [quarters, expandedQuarters, months, aggregate]);

  const toggleQuarter = (quarter: QuarterNo) =>
    setExpandedQuarters((prev) => {
      const next = new Set(prev);
      if (next.has(quarter)) next.delete(quarter);
      else next.add(quarter);
      return next;
    });

  const toggleGroup = (code: string) =>
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  // Which detail rows are currently shown.
  const visibleLines = useMemo(
    () =>
      lines.filter((line) => {
        if (line.level === 0) return true;
        if (showAllDetail) return true;
        return line.groupCode ? openGroups.has(line.groupCode) : false;
      }),
    [lines, openGroups, showAllDetail],
  );

  const hasDetail = useMemo(() => {
    const set = new Set<string>();
    for (const line of lines) if (line.level === 1 && line.groupCode) set.add(line.groupCode);
    return set;
  }, [lines]);

  const allExpanded = expandedQuarters.size === quarters.length;

  return (
    <div className="rounded-card border border-line bg-surface">
      {/* Controls */}
      <div className="no-print flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() =>
              setExpandedQuarters(
                allExpanded ? new Set() : new Set(quarters.map((q) => q.quarter)),
              )
            }
            className="rounded-md border border-line px-2.5 py-1.5 text-[12px] font-medium text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
          >
            {allExpanded ? "Collapse to quarters" : "Expand to months"}
          </button>
          <button
            type="button"
            onClick={() => setShowAllDetail((v) => !v)}
            className="rounded-md border border-line px-2.5 py-1.5 text-[12px] font-medium text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
          >
            {showAllDetail ? "Hide account detail" : "Show account detail"}
          </button>
        </div>

        <label className="flex items-center gap-2 text-[12px] text-ink-muted">
          <span>Figures</span>
          <select
            value={scale}
            onChange={(e) => setScale(e.target.value as Scale)}
            className="rounded-md border border-line bg-surface px-2 py-1.5 text-[12px] text-ink"
          >
            <option value="abs">in rupees</option>
            <option value="thousands">in thousands</option>
            <option value="lakhs">in lakhs</option>
            <option value="crores">in crores</option>
          </select>
        </label>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-[13px]">
          <thead>
            <tr className="bg-surface">
              <th
                scope="col"
                className="sticky-label border-b border-line-strong bg-surface px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-faint"
              >
                <span className="block min-w-[200px]">{scaleLabel[scale]}</span>
              </th>
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className={clsx(
                    "border-b border-line-strong px-3 py-2.5 text-right text-[12px] font-semibold",
                    col.startsGroup && "border-l border-line",
                    col.kind === "total"
                      ? "bg-navy-tint text-navy"
                      : col.kind === "quarter"
                        ? "text-ink"
                        : "text-ink-muted",
                  )}
                >
                  {col.quarter && col.kind === "quarter" && !expandedQuarters.has(col.quarter) ? (
                    <button
                      type="button"
                      onClick={() => toggleQuarter(col.quarter!)}
                      className="no-print inline-flex items-center gap-1 whitespace-nowrap hover:text-navy"
                      title="Show months"
                    >
                      <Chevron open={false} />
                      {col.label}
                    </button>
                  ) : col.quarter && col.kind === "quarter" ? (
                    <button
                      type="button"
                      onClick={() => toggleQuarter(col.quarter!)}
                      className="no-print inline-flex items-center gap-1 whitespace-nowrap hover:text-navy"
                      title="Collapse to quarter"
                    >
                      <Chevron open />
                      {col.label}
                    </button>
                  ) : (
                    <span className="whitespace-nowrap">{col.label}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {visibleLines.map((line) => {
              const isGroup = line.level === 0;
              const strong = line.isSubtotal;
              const highlighted = line.groupCode ? emphasise.includes(line.groupCode) : false;
              const canOpen = isGroup && line.groupCode && hasDetail.has(line.groupCode);

              return (
                <tr
                  key={line.key}
                  className={clsx(
                    "group",
                    strong && "bg-surface",
                    highlighted && "bg-navy-tint/40",
                    !isGroup && "bg-surface-sunk/40",
                  )}
                >
                  <th
                    scope="row"
                    className={clsx(
                      "sticky-label px-4 py-2 text-left font-normal",
                      strong ? "border-t border-line-strong" : "border-t border-line",
                      highlighted ? "bg-navy-tint" : !isGroup ? "bg-surface-sunk" : "bg-surface",
                    )}
                  >
                    <span
                      className={clsx(
                        "block min-w-[200px]",
                        !isGroup && "pl-4 text-ink-muted",
                        strong && "font-semibold text-ink",
                        highlighted && "font-semibold text-navy",
                      )}
                    >
                      {canOpen ? (
                        <button
                          type="button"
                          onClick={() => toggleGroup(line.groupCode!)}
                          className="no-print inline-flex items-center gap-1.5 text-left hover:text-navy"
                        >
                          <Chevron open={openGroups.has(line.groupCode!) || showAllDetail} />
                          {line.name}
                        </button>
                      ) : (
                        line.name
                      )}
                    </span>
                  </th>

                  {columns.map((col) => {
                    const how =
                      line.columnAggregate ?? (aggregate === "closing" ? "last" : "sum");
                    const raw =
                      how === "last"
                        ? (line.values[col.months[col.months.length - 1]] ?? 0)
                        : how === "first"
                          ? (line.values[col.months[0]] ?? 0)
                          : col.months.reduce((sum, key) => sum + (line.values[key] ?? 0), 0);
                    const display = scaled(raw * line.sign, scale);
                    const negative = display < -0.004;
                    const zero = Math.abs(display) < 0.005;
                    const href = drillHref?.(line, col.months) ?? null;

                    const content = zero ? (
                      <span className="text-ink-faint">&ndash;</span>
                    ) : (
                      <span className={clsx("num", negative && "num-negative")}>
                        {money(display, scale === "abs" ? 0 : scale === "thousands" ? 0 : 2)}
                      </span>
                    );

                    return (
                      <td
                        key={col.key}
                        className={clsx(
                          "px-3 py-2 text-right whitespace-nowrap",
                          strong ? "border-t border-line-strong" : "border-t border-line",
                          col.startsGroup && "border-l border-line",
                          col.kind === "total" && "bg-navy-tint/60",
                          strong && "font-semibold",
                          negative ? "text-negative" : "text-ink",
                          highlighted && "font-semibold",
                        )}
                      >
                        {href && !zero ? (
                          <a href={href} className="hover:underline">
                            {content}
                          </a>
                        ) : (
                          content
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden="true"
      className={clsx(
        "h-2.5 w-2.5 shrink-0 transition-transform duration-150",
        open && "rotate-90",
      )}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 2l4 4-4 4" />
    </svg>
  );
}

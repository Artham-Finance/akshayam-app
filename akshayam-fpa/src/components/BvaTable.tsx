"use client";

import { useRouter } from "next/navigation";
import { Fragment, useState, useTransition } from "react";
import clsx from "clsx";
import { dateLabel, money, percent } from "@/lib/format";
import type { BvaCode, BvaLine } from "@/lib/reports/budget-pnl";
import type { FyMonth } from "@/lib/period";

const sum = (values: Record<string, number>, months: FyMonth[]) =>
  months.reduce((total, m) => total + (values[m.key] ?? 0), 0);

/** One ledger posting behind a sub-line's own actual - what its own drill-down shows. */
export interface StatementDetailEntry {
  /** YYYY-MM-DD */
  date: string;
  /** the bill's narration, or the transaction type when it has none */
  primary: string;
  /** the ledger's reference-number field, or a second narration - shown as the Description column */
  secondary: string;
  /** cost-positive rupees */
  amount: number;
}

/** One sub-line behind a statement row - Team lead, Branch Office Rent, and so on. */
export interface StatementDetailLine {
  label: string;
  hint?: string;
  periodBudget: number;
  periodActual: number;
  ytdBudget: number;
  ytdActual: number;
  /** the postings behind ytdActual, newest first - always the year to date's, regardless of the page's own period */
  entries: StatementDetailEntry[];
}

/**
 * Budget against actual, down the statement.
 *
 * Same Period / YTD shape as the Other-expenses and cost breakdown cards
 * below it: the period columns read whatever the page's own picker is
 * showing, the YTD columns read the year to date always, and variance and
 * its percentage are struck on the YTD pair only.
 *
 * A cost line holds a positive magnitude, so "variance" has to mean the same
 * thing on every row: **better or worse than budget**. Spending less than
 * budget is favourable and earning less is not, and a table that showed both
 * as a plain subtraction would colour half of them the wrong way.
 *
 * `detail` and `commonCostEdit` are Akshayam-only: a global "Show cost
 * detail" toggle (the same one the P&L page's vertical cards use) reveals
 * each cost line's own sub-lines in place, and Common cost apportionment's
 * actual - which no ledger posting ever supplies - can be keyed in by hand.
 * Neither prop is passed for any other company, so the statement there
 * renders exactly as it always has.
 */
export function BvaStatement({
  lines,
  periodMonths,
  ytdMonths,
  periodLabel,
  ytdLabel,
  detail,
  commonCostEdit,
}: {
  lines: BvaLine[];
  periodMonths: FyMonth[];
  ytdMonths: FyMonth[];
  /** short label for the period columns, e.g. "This month" or "Jul 26" */
  periodLabel: string;
  /** short label for the YTD columns, e.g. "to 27 Aug 26" */
  ytdLabel: string;
  /** sub-line breakdown per statement code, shown under the "Show cost detail" toggle */
  detail?: Partial<Record<BvaCode, StatementDetailLine[]>>;
  /** lets Common cost apportionment's period actual be keyed in by hand, one month at a time */
  commonCostEdit?: { entityId: number; fyStartYear: number; month: string | null; canEdit: boolean };
}) {
  const router = useRouter();
  const [showDetail, setShowDetail] = useState(false);
  const [openSubLine, setOpenSubLine] = useState<string | null>(null);
  const [applyForward, setApplyForward] = useState(true);
  const [saving, startSave] = useTransition();

  const head =
    "border-y border-line px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-faint";
  const subhead = "mt-0.5 block text-[10px] font-normal normal-case tracking-normal text-ink-faint";
  const hasDetail = !!detail && Object.values(detail).some((d) => d && d.length > 0);
  const editCommonCost = !!commonCostEdit?.canEdit && commonCostEdit.month !== null;

  const saveCommonCost = async (amount: number) => {
    if (!commonCostEdit || commonCostEdit.month === null) return;
    try {
      await fetch("/api/common-cost-actual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entityId: commonCostEdit.entityId,
          fyStartYear: commonCostEdit.fyStartYear,
          month: `${commonCostEdit.month}-01`,
          amount,
          applyForward,
        }),
      });
      startSave(() => router.refresh());
    } catch {
      /* a failed save leaves the field as typed; the next edit retries */
    }
  };

  return (
    <>
      {(hasDetail || editCommonCost) && (
        <div className="no-print flex flex-wrap items-center gap-3 px-4 pb-3 sm:px-4">
          {hasDetail && (
            <button
              type="button"
              onClick={() => setShowDetail((v) => !v)}
              className="rounded-md border border-line px-2.5 py-1.5 text-[12px] font-medium text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
            >
              {showDetail ? "Hide cost detail" : "Show cost detail"}
            </button>
          )}
          {editCommonCost && (
            <label className="flex items-center gap-1.5 text-[12px] text-ink-muted">
              <input
                type="checkbox"
                checked={applyForward}
                onChange={(e) => setApplyForward(e.target.checked)}
                className="accent-navy"
              />
              Common cost apportionment: apply to {periodLabel} and the rest of the year
            </label>
          )}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-[13px]">
          <caption className="px-4 pb-3 text-left text-[11.5px] text-ink-muted">
            A favourable variance is more revenue, or less cost, than budget.
            {commonCostEdit && !editCommonCost && (
              <span className="block">
                Common cost apportionment has no ledger posting of its own — pick a month above to
                key its actual in.
              </span>
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
            {lines.map((line) => {
              const periodBudget = sum(line.budget, periodMonths);
              const periodActual = sum(line.actual, periodMonths);
              const ytdBudget = sum(line.budget, ytdMonths);
              const ytdActual = sum(line.actual, ytdMonths);
              // Costs are held positive, so under-spending is the favourable case.
              const ytdVariance = line.sign === -1 ? ytdBudget - ytdActual : ytdActual - ytdBudget;
              const ytdPct = ytdBudget === 0 ? null : (ytdVariance / ytdBudget) * 100;
              const favourable = ytdVariance >= -0.5;
              const editable = editCommonCost && line.code === "common_cost_apportionment";
              const subLines = detail?.[line.code];

              return (
                <Fragment key={line.code}>
                  <tr
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
                      {money(periodBudget)}
                    </td>
                    <td
                      className={clsx(
                        "num border-b border-line px-4 py-2 text-right font-medium",
                        periodActual < -0.5 ? "num-negative text-negative" : "text-ink",
                      )}
                    >
                      {editable ? (
                        <AmountInput
                          value={periodActual}
                          disabled={saving}
                          onSave={saveCommonCost}
                        />
                      ) : (
                        money(periodActual)
                      )}
                    </td>
                    <td className="num border-b border-line px-4 py-2 text-right text-ink-muted">
                      {money(ytdBudget)}
                    </td>
                    <td
                      className={clsx(
                        "num border-b border-line px-4 py-2 text-right font-medium",
                        ytdActual < -0.5 ? "num-negative text-negative" : "text-ink",
                      )}
                    >
                      {money(ytdActual)}
                    </td>
                    <td
                      className={clsx(
                        "num border-b border-line px-4 py-2 text-right",
                        favourable ? "text-positive" : "num-negative text-negative",
                      )}
                    >
                      {money(ytdVariance)}
                    </td>
                    <td
                      className={clsx(
                        "num border-b border-line px-4 py-2 text-right",
                        ytdPct === null ? "text-ink-faint" : favourable ? "text-positive" : "text-caution",
                      )}
                    >
                      {ytdPct === null ? "—" : percent(ytdPct, 1)}
                    </td>
                  </tr>
                  {showDetail &&
                    subLines?.map((s) => {
                      const v = s.ytdBudget - s.ytdActual;
                      const pct = s.ytdBudget === 0 ? null : (v / s.ytdBudget) * 100;
                      const ok = v >= -0.5;
                      const subKey = `${line.code}|${s.label}`;
                      const subOpen = openSubLine === subKey;
                      const canOpen = s.entries.length > 0;
                      return (
                        <Fragment key={subKey}>
                          <tr className="hover:bg-surface-sunk/40">
                            <th
                              scope="row"
                              className="border-b border-line px-4 py-2 pl-12 text-left font-normal text-ink-muted"
                            >
                              <button
                                type="button"
                                onClick={() => setOpenSubLine((cur) => (cur === subKey ? null : subKey))}
                                disabled={!canOpen}
                                aria-expanded={subOpen}
                                className={clsx(
                                  "flex items-start gap-1.5 text-left",
                                  canOpen ? "hover:text-navy" : "cursor-default",
                                )}
                              >
                                <span
                                  className={clsx(
                                    "mt-[3px] text-[9px] text-ink-faint transition-transform",
                                    subOpen && "rotate-90",
                                    !canOpen && "opacity-0",
                                  )}
                                >
                                  ▶
                                </span>
                                <span>
                                  {s.label}
                                  {s.hint && (
                                    <span className="block text-[10px] font-normal text-ink-faint">
                                      {s.hint}
                                    </span>
                                  )}
                                  {canOpen && (
                                    <span className="ml-2 text-[11px] font-normal text-ink-faint">
                                      {s.entries.length} posting{s.entries.length === 1 ? "" : "s"}
                                    </span>
                                  )}
                                </span>
                              </button>
                            </th>
                            <td className="num border-b border-line px-4 py-2 text-right text-ink-faint">
                              {money(s.periodBudget)}
                            </td>
                            <td className="num border-b border-line px-4 py-2 text-right text-ink-faint">
                              {s.periodActual ? money(s.periodActual) : "—"}
                            </td>
                            <td className="num border-b border-line px-4 py-2 text-right text-ink-faint">
                              {money(s.ytdBudget)}
                            </td>
                            <td className="num border-b border-line px-4 py-2 text-right text-ink-faint">
                              {s.ytdActual ? money(s.ytdActual) : "—"}
                            </td>
                            <td
                              className={clsx(
                                "num border-b border-line px-4 py-2 text-right",
                                ok ? "text-ink-faint" : "text-negative",
                              )}
                            >
                              {money(v)}
                            </td>
                            <td
                              className={clsx(
                                "num border-b border-line px-4 py-2 text-right",
                                pct === null ? "text-ink-faint" : ok ? "text-ink-faint" : "text-caution",
                              )}
                            >
                              {pct === null ? "—" : percent(pct, 1)}
                            </td>
                          </tr>
                          {subOpen && canOpen && (
                            <tr>
                              <td colSpan={7} className="border-b border-line bg-surface-sunk/30 px-4 py-3 sm:px-8">
                                <SubLineDrillTable entries={s.entries} total={s.ytdActual} />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** The ledger postings behind one sub-line's own actual, newest first. */
function SubLineDrillTable({ entries, total }: { entries: StatementDetailEntry[]; total: number }) {
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
        {entries.map((e, i) => (
          <tr key={i} className="text-ink">
            <td className={clsx(cell, "num whitespace-nowrap text-ink-muted")}>{dateLabel(e.date)}</td>
            <td className={cell}>{e.primary}</td>
            <td className={clsx(cell, "text-ink-muted")}>{e.secondary || "—"}</td>
            <td className={clsx(cell, "num text-right font-medium")}>{money(e.amount)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="font-semibold text-ink">
          <td className={clsx(cell, "border-t-line-strong")} colSpan={3}>
            {entries.length} posting{entries.length === 1 ? "" : "s"}
          </td>
          <td className={clsx(cell, "num border-t-line-strong text-right")}>{money(total)}</td>
        </tr>
      </tfoot>
    </table>
  );
}

/** A free rupee figure, committed on blur or Enter - for Common cost apportionment's keyed-in actual. */
function AmountInput({
  value,
  disabled,
  onSave,
}: {
  value: number;
  disabled: boolean;
  onSave: (v: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) return;
    const raw = draft.trim();
    setDraft(null);
    const n = raw === "" ? 0 : Number(raw);
    if (Number.isFinite(n) && n !== value) onSave(n);
  };

  return (
    <input
      value={draft ?? String(value)}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value.replace(/[^0-9.-]/g, ""))}
      onFocus={(e) => {
        setDraft(String(value));
        e.currentTarget.select();
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(null);
          e.currentTarget.blur();
        }
      }}
      inputMode="decimal"
      className="num w-28 rounded-md border border-line bg-surface px-1.5 py-0.5 text-right text-[13px] font-medium text-ink outline-none focus:border-navy disabled:opacity-50"
    />
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

"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import clsx from "clsx";
import { money, moneySigned, percent } from "@/lib/format";
import type { ExpenseDetailLine, ExpenseEntry } from "@/lib/reports/expense-detail";

/**
 * The breakdown behind Other expenses, and the bills that make it up.
 *
 * Every line carries two windows: the period the page's own picker is
 * showing, and the year to date, always - so a reader comparing "This month"
 * is never cut off from the full-year story. Variance and its percentage are
 * struck on the year-to-date pair; the period columns are for reading
 * against whatever the picker shows, not for re-scoring the year one slice
 * at a time.
 *
 * A line's actual is the sum of what has been recorded under it, so opening a
 * line shows the bills rather than an explanation of a figure struck
 * elsewhere. Nothing is read from the ledger: the account names do not line up
 * with the budget's heads closely enough to be trusted, and a figure matched
 * by name would be wrong in a way nobody could see.
 *
 * Entries belong to a month, so only a single month can be edited, and only
 * the period's own bills are ever opened. A quarter or a year to date is
 * shown read-only rather than inviting an entry that would have nowhere to be
 * filed.
 */
export function ExpenseDetailTable({
  lines,
  fy,
  month,
  monthLabel,
  periodLabel,
  ytdLabel,
  vendors,
}: {
  lines: ExpenseDetailLine[];
  fy: number;
  /** 'YYYY-MM-01', or null when the period spans more than one month */
  month: string | null;
  monthLabel: string | null;
  /** short label for the period columns, e.g. "This month" or "Year to date" */
  periodLabel: string;
  /** short label for the YTD columns, e.g. "to 27 Aug 26" */
  ytdLabel: string;
  /** names offered on the entry form */
  vendors: string[];
}) {
  const head =
    "border-y border-line px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-faint";
  const subhead = "mt-0.5 block text-[10px] font-normal normal-case tracking-normal text-ink-faint";
  const vendorListId = useId();

  const totals = lines.reduce(
    (acc, l) => {
      // A deduction line (reimbursement income) subtracts from the total.
      const periodActual = l.isDeduction ? -l.periodActual : l.periodActual;
      const ytdActual = l.isDeduction ? -l.ytdActual : l.ytdActual;
      return {
        periodBudget: acc.periodBudget + l.periodBudget,
        periodActual: acc.periodActual + periodActual,
        ytdBudget: acc.ytdBudget + l.ytdBudget,
        ytdActual: acc.ytdActual + ytdActual,
        ytdVariance: acc.ytdVariance + (l.ytdBudget - ytdActual),
      };
    },
    { periodBudget: 0, periodActual: 0, ytdBudget: 0, ytdActual: 0, ytdVariance: 0 },
  );
  const ytdVariancePct = totals.ytdBudget ? (totals.ytdVariance / totals.ytdBudget) * 100 : null;

  let lastHead: string | null = null;

  return (
    <div className="overflow-x-auto">
      {/* One list for the whole table: the same vendors are offered on every line. */}
      <datalist id={vendorListId}>
        {vendors.map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>

      <table className="w-full min-w-max border-collapse text-[13px]">
        <caption className="px-4 pb-3 text-left text-[11.5px] text-ink-muted">
          {month
            ? "Open a line to see the bills behind it and record another. Each line's actual is the sum of its entries."
            : "Read-only across more than one month — an entry belongs to the month the cost is reported in. Pick a single month to record one."}
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
            <th scope="col" className={clsx(head, "text-right")}>
              Entries
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => {
            const newHead = line.head !== lastHead && !line.isHeadOnly;
            lastHead = line.head;
            return (
              <ExpenseRow
                key={`${line.head}|${line.label}`}
                line={line}
                fy={fy}
                month={month}
                showHead={newHead}
                vendorListId={vendorListId}
              />
            );
          })}
        </tbody>
        <tfoot>
          <tr className="bg-surface-sunk font-semibold">
            <th scope="row" className="border-y border-line-strong px-3 py-2 text-left">
              Other expenses{monthLabel ? ` — ${monthLabel}` : ""}
            </th>
            <td className="num border-y border-line-strong px-3 py-2 text-right">
              {money(totals.periodBudget)}
            </td>
            <td
              className={clsx(
                "num border-y border-line-strong px-3 py-2 text-right",
                totals.periodActual < 0 && "text-negative",
              )}
            >
              {moneySigned(totals.periodActual)}
            </td>
            <td className="num border-y border-line-strong px-3 py-2 text-right">
              {money(totals.ytdBudget)}
            </td>
            <td
              className={clsx(
                "num border-y border-line-strong px-3 py-2 text-right",
                totals.ytdActual < 0 && "text-negative",
              )}
            >
              {moneySigned(totals.ytdActual)}
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
                ytdVariancePct !== null && ytdVariancePct < 0 ? "text-negative" : "text-positive",
              )}
            >
              {ytdVariancePct === null ? "—" : percent(ytdVariancePct)}
            </td>
            <td className="border-y border-line-strong px-3 py-2" />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function ExpenseRow({
  line,
  fy,
  month,
  showHead,
  vendorListId,
}: {
  line: ExpenseDetailLine;
  fy: number;
  month: string | null;
  showHead: boolean;
  vendorListId: string;
}) {
  const [open, setOpen] = useState(false);
  const cell = "border-b border-line px-3 py-2";

  return (
    <>
      {showHead && (
        <tr className="bg-surface-sunk/60">
          <th
            scope="row"
            colSpan={8}
            className="border-b border-line px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted"
          >
            {line.head}
          </th>
        </tr>
      )}
      <tr className="hover:bg-surface-sunk/40">
        <th
          scope="row"
          className={clsx(cell, "text-left font-normal text-ink", !line.isHeadOnly && "pl-6")}
        >
          {line.label}
          {line.hint && (
            <span className="mt-0.5 block text-[11px] font-normal normal-case tracking-normal text-ink-faint">
              {line.hint}
            </span>
          )}
        </th>
        <td className={clsx(cell, "num text-right", line.isActualOnly && "text-ink-faint")}>
          {line.isActualOnly ? "—" : money(line.periodBudget)}
        </td>
        <td className={clsx(cell, "num text-right text-ink")}>
          {line.isLedger ? moneySigned(line.periodActual) : money(line.periodActual)}
        </td>
        <td className={clsx(cell, "num text-right", line.isActualOnly && "text-ink-faint")}>
          {line.isActualOnly ? "—" : money(line.ytdBudget)}
        </td>
        <td className={clsx(cell, "num text-right text-ink")}>
          {line.isLedger ? moneySigned(line.ytdActual) : money(line.ytdActual)}
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
          {line.isActualOnly ? "—" : money(line.ytdVariance)}
        </td>
        <td
          className={clsx(
            cell,
            "num text-right",
            line.isActualOnly
              ? "text-ink-faint"
              : line.ytdVariancePct !== null && line.ytdVariancePct < 0
                ? "text-negative"
                : "text-ink-muted",
          )}
        >
          {line.isActualOnly || line.ytdVariancePct === null ? "—" : percent(line.ytdVariancePct)}
        </td>
        <td className={clsx(cell, "text-right")}>
          {line.isLedger ? (
            <span className="text-[11px] uppercase tracking-[0.08em] text-ink-faint">Ledger</span>
          ) : (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="rounded-md border border-line px-2 py-0.5 text-[11.5px] font-medium text-ink-muted hover:bg-surface-sunk"
            >
              {line.entries.length > 0 ? `${line.entries.length} · ` : ""}
              {open ? "Close" : month ? "Open" : "View"}
            </button>
          )}
        </td>
      </tr>
      {open && !line.isLedger && (
        <tr>
          <td colSpan={8} className="border-b border-line bg-surface-sunk/30 px-3 py-3 sm:px-6">
            <EntryPanel
              line={line}
              fy={fy}
              month={month}
              vendorListId={vendorListId}
              onDone={() => setOpen(true)}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function EntryPanel({
  line,
  fy,
  month,
  vendorListId,
  onDone,
}: {
  line: ExpenseDetailLine;
  fy: number;
  month: string | null;
  vendorListId: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The month's first day is the sensible default: most bills entered against
  // a month were spent in it, and a wrong date is easier to see than an empty
  // one is to remember.
  const [spentOn, setSpentOn] = useState(month ?? "");
  const [vendor, setVendor] = useState("");
  const [amount, setAmount] = useState("");
  const [remark, setRemark] = useState("");

  const post = async (body: unknown) => {
    setError(null);
    setBusy(true);
    try {
      const response = await fetch("/api/expense-actuals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? "Could not save.");
        return false;
      }
      startTransition(() => router.refresh());
      onDone();
      return true;
    } catch {
      setError("Could not reach the server.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const raw = amount.trim().replace(/[,\s₹]/g, "");
    if (raw === "" || !Number.isFinite(Number(raw))) {
      setError("Enter an amount.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(spentOn)) {
      setError("Enter the date it was spent.");
      return;
    }
    const saved = await post({
      action: "create",
      fy,
      month,
      head: line.head,
      label: line.label,
      spentOn,
      vendor: vendor.trim() || null,
      amount: Number(raw),
      remark: remark.trim() || null,
    });
    if (saved) {
      setVendor("");
      setAmount("");
      setRemark("");
    }
  };

  const field =
    "rounded-md border border-line bg-surface px-2 py-1 text-[12px] text-ink placeholder:text-ink-faint";

  return (
    <div className="space-y-3">
      {line.entries.length > 0 ? (
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="text-ink-faint">
              <th scope="col" className="px-2 py-1 text-left font-medium">Date</th>
              <th scope="col" className="px-2 py-1 text-left font-medium">Vendor</th>
              <th scope="col" className="px-2 py-1 text-right font-medium">Amount</th>
              <th scope="col" className="px-2 py-1 text-left font-medium">Remarks</th>
              <th scope="col" className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {line.entries.map((entry) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                editable={month !== null}
                busy={busy}
                onDelete={() => post({ action: "delete", id: entry.id })}
              />
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-[12px] text-ink-muted">
          Nothing recorded against this line{month ? " for the month" : ""} yet.
        </p>
      )}

      {month && (
        <div className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
          <label className="flex flex-col gap-1 text-[11px] text-ink-muted">
            Date
            <input
              type="date"
              value={spentOn}
              onChange={(e) => setSpentOn(e.target.value)}
              className={clsx(field, "w-36")}
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-ink-muted">
            Vendor
            <input
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              list={vendorListId}
              placeholder="Who it was paid to"
              className={clsx(field, "w-52")}
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-ink-muted">
            Amount
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="0"
              className={clsx(field, "num w-28 text-right")}
            />
          </label>
          <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-[11px] text-ink-muted">
            Remarks
            <input
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder="Anything worth saying about it"
              className={field}
            />
          </label>
          <button
            type="button"
            onClick={add}
            disabled={busy}
            className="rounded-md bg-navy px-3 py-1.5 text-[12px] font-medium text-ink-invert hover:bg-navy-deep disabled:opacity-60"
          >
            {busy ? "Saving…" : "Add entry"}
          </button>
          {error && <span className="text-[11.5px] text-negative">{error}</span>}
        </div>
      )}
    </div>
  );
}

function EntryRow({
  entry,
  editable,
  busy,
  onDelete,
}: {
  entry: ExpenseEntry;
  editable: boolean;
  busy: boolean;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const cell = "border-t border-line px-2 py-1.5";

  return (
    <tr className="text-ink">
      <td className={clsx(cell, "num whitespace-nowrap text-ink-muted")}>
        {new Date(entry.spentOn).toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "2-digit",
        })}
      </td>
      <td className={cell}>{entry.vendor ?? <span className="text-ink-faint">—</span>}</td>
      <td className={clsx(cell, "num text-right font-medium")}>{money(entry.amount)}</td>
      <td className={clsx(cell, "max-w-[22rem] text-ink-muted")}>{entry.remark}</td>
      <td className={clsx(cell, "text-right")}>
        {editable &&
          (confirming ? (
            <span className="whitespace-nowrap">
              <button
                type="button"
                onClick={onDelete}
                disabled={busy}
                className="rounded-md border border-negative/30 px-1.5 py-0.5 text-[11px] font-medium text-negative hover:bg-negative/10 disabled:opacity-60"
              >
                Remove
              </button>{" "}
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="text-[11px] text-ink-faint hover:text-ink"
              >
                keep
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="text-[11px] text-ink-faint hover:text-negative"
              title="Remove this entry"
            >
              ×
            </button>
          ))}
      </td>
    </tr>
  );
}

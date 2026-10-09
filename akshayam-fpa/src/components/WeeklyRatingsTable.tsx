"use client";

import { Fragment, useId, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { money, percent } from "@/lib/format";
import { isSaturday } from "@/lib/weekly";
import type { WeeklyRow } from "@/lib/reports/weekly-ratings";

/**
 * The weekly commitment screen's table: one row per vertical, and under a row
 * the customer-by-customer commitment, its outcome, and (for an admin) the
 * switch that reopens a frozen one.
 *
 * Amounts can be changed only until the end of the day they were first keyed,
 * and only by whoever may commit; the server enforces both, this just stops
 * offering what will be refused. "Achieved?" is the outcome, said afterwards,
 * so it is editable whenever there is a commitment.
 */

const RATING_TONE = [
  "bg-negative-tint text-negative",
  "bg-negative-tint text-negative",
  "bg-caution-tint text-caution",
  "bg-positive-tint text-positive",
  "bg-positive-tint text-positive",
];

const ACHIEVED_LABEL = { yes: "Yes", partly: "Partly", no: "No" } as const;

function Rating({ value }: { value: number | null }) {
  if (value === null) return <span className="text-ink-faint">—</span>;
  return (
    <span
      className={clsx(
        "inline-flex h-6 min-w-6 items-center justify-center rounded-full px-2 text-[12px] font-semibold",
        RATING_TONE[value] ?? RATING_TONE[0],
      )}
    >
      {value}
    </span>
  );
}

export function WeeklyRatingsTable({
  rows,
  measure,
  weekEnd,
  meetingDate,
  canCommit,
  isAdmin,
  quarterLabel,
}: {
  rows: WeeklyRow[];
  measure: "revenue" | "collection" | "receivables";
  weekEnd: string;
  meetingDate: string;
  canCommit: boolean;
  isAdmin: boolean;
  quarterLabel: string;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const head =
    "border-y border-line px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-faint";
  const cell = "border-b border-line px-3 py-2";
  const actualLabel = measure === "revenue" ? "Actual revenue (GL)" : measure === "collection" ? "Actual collection" : "Recovered from committed";
  const committedLabel =
    measure === "revenue" ? "Revenue committed" : measure === "collection" ? "Collection committed" : "Overdue to recover";

  return (
    <div className="table-frame">
      <table className="w-full min-w-max border-collapse text-[13px]">
        <thead>
          <tr>
            <th scope="col" className={clsx(head, "text-left")}>Vertical</th>
            <th scope="col" className={clsx(head, "text-right")}>Weekly budget</th>
            <th scope="col" className={clsx(head, "text-right")}>{committedLabel}</th>
            <th scope="col" className={clsx(head, "text-center")}>Weekly rating</th>
            <th scope="col" className={clsx(head, "text-right")}>{actualLabel}</th>
            <th scope="col" className={clsx(head, "text-right")}>% of commitment</th>
            <th scope="col" className={clsx(head, "text-center")}>Scorecard {quarterLabel}</th>
            <th scope="col" className={clsx(head, "text-center")}>Achieved?</th>
            <th scope="col" className={head} />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isOpen = open === row.verticalId;
            return (
              <Fragment key={row.verticalId}>
                <tr className="hover:bg-surface-sunk/40">
                  <th scope="row" className={clsx(cell, "text-left font-medium text-ink")}>
                    {row.label}
                    {row.locked && (
                      <span className="ml-2 rounded-sm bg-surface-sunk px-1.5 py-0.5 text-[10px] font-normal uppercase tracking-[0.08em] text-ink-faint">
                        frozen
                      </span>
                    )}
                  </th>
                  <td className={clsx(cell, "num text-right text-ink-muted")}>
                    {row.budget === null ? "—" : money(row.budget)}
                  </td>
                  <td className={clsx(cell, "num text-right text-ink")}>
                    {row.hasCommitment ? money(row.committed) : <span className="text-ink-faint">not keyed</span>}
                  </td>
                  <td className={clsx(cell, "text-center")}>
                    <Rating value={row.rating} />
                  </td>
                  <td className={clsx(cell, "num text-right text-ink")}>{money(row.actual)}</td>
                  <td className={clsx(cell, "num text-right text-ink-muted")}>
                    {row.pctOfCommitment === null ? "—" : percent(row.pctOfCommitment * 100, 0)}
                  </td>
                  <td className={clsx(cell, "num text-center text-ink-muted")}>
                    {row.quarterComposite === null ? "—" : row.quarterComposite.toFixed(2)}
                  </td>
                  <td className={clsx(cell, "text-center text-ink")}>
                    {row.achieved ? ACHIEVED_LABEL[row.achieved] : <span className="text-ink-faint">—</span>}
                  </td>
                  <td className={clsx(cell, "text-right")}>
                    <button
                      type="button"
                      onClick={() => setOpen(isOpen ? null : row.verticalId)}
                      className="rounded-md border border-line px-2 py-0.5 text-[11.5px] font-medium text-ink-muted hover:bg-surface-sunk"
                    >
                      {isOpen ? "Close" : canCommit && !row.locked ? (row.hasCommitment ? "Edit" : "Commit") : "Open"}
                    </button>
                  </td>
                </tr>
                {isOpen && (
                  <tr>
                    <td colSpan={9} className="border-b border-line bg-surface-sunk/30 px-3 py-3 sm:px-6">
                      <CommitmentPanel
                        row={row}
                        measure={measure}
                        weekEnd={weekEnd}
                        meetingDate={meetingDate}
                        canCommit={canCommit}
                        isAdmin={isAdmin}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface DraftLine {
  customer: string;
  amount: string;
}

function CommitmentPanel({
  row,
  measure,
  weekEnd,
  meetingDate,
  canCommit,
  isAdmin,
}: {
  row: WeeklyRow;
  measure: "revenue" | "collection" | "receivables";
  weekEnd: string;
  meetingDate: string;
  canCommit: boolean;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const listId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [lines, setLines] = useState<DraftLine[]>(
    row.lines.length > 0
      ? row.lines.map((l) => ({ customer: l.customer, amount: String(l.amount) }))
      : [{ customer: "", amount: "" }],
  );
  const [meeting, setMeeting] = useState(row.meetingDate ?? meetingDate);
  const [achieved, setAchieved] = useState<string>(row.achieved ?? "");
  const [remarks, setRemarks] = useState(row.remarks ?? "");

  const editable = canCommit && !row.locked;
  const field =
    "rounded-md border border-line bg-surface px-2 py-1 text-[12px] text-ink placeholder:text-ink-faint";

  const draftTotal = lines.reduce((s, l) => {
    const n = Number(l.amount.replace(/[,\s₹]/g, ""));
    return s + (Number.isFinite(n) ? n : 0);
  }, 0);

  const post = async (body: Record<string, unknown>, done: string) => {
    setError(null);
    setNote(null);
    setBusy(true);
    try {
      const response = await fetch("/api/weekly-commitments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verticalId: row.verticalId, measure, weekEnd, ...body }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? "Could not save.");
        return;
      }
      setNote(done);
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    const cleaned: { customer: string; amount: number }[] = [];
    for (const l of lines) {
      const customer = l.customer.trim();
      const raw = l.amount.trim().replace(/[,\s₹]/g, "");
      if (!customer && !raw) continue;
      const amount = Number(raw);
      if (!customer || raw === "" || !Number.isFinite(amount) || amount <= 0) {
        setError("Each line needs a customer and an amount above nil.");
        return;
      }
      cleaned.push({ customer, amount });
    }
    if (cleaned.length === 0) {
      setError("Add at least one customer with an amount.");
      return;
    }
    if (!isSaturday(meeting)) {
      setError("The meeting date must be a Saturday.");
      return;
    }
    void post({ action: "save", meetingDate: meeting, lines: cleaned }, "Saved. It freezes at the end of today.");
  };

  return (
    <div className="space-y-4">
      {row.hasCommitment && (
        <p className="text-[12px] text-ink-muted">
          Committed at the meeting of {row.meetingDate}, first keyed {row.enteredOn}.{" "}
          {row.locked
            ? "The amounts froze at the end of that day."
            : "The amounts freeze at the end of the day they were first keyed."}
        </p>
      )}

      {editable ? (
        <div className="space-y-2">
          <datalist id={listId}>
            {row.customers.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <table className="w-full max-w-3xl border-collapse text-[12px]">
            <thead>
              <tr className="text-ink-faint">
                <th scope="col" className="px-1 py-1 text-left font-medium">Customer</th>
                <th scope="col" className="px-1 py-1 text-right font-medium">Amount committed</th>
                <th scope="col" className="px-1 py-1" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td className="px-1 py-1">
                    <input
                      value={l.customer}
                      onChange={(e) =>
                        setLines((cur) => cur.map((x, j) => (j === i ? { ...x, customer: e.target.value } : x)))
                      }
                      list={listId}
                      placeholder="Pick or type a customer"
                      className={clsx(field, "w-full")}
                      aria-label="Customer"
                    />
                  </td>
                  <td className="px-1 py-1">
                    <input
                      value={l.amount}
                      onChange={(e) =>
                        setLines((cur) => cur.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))
                      }
                      inputMode="decimal"
                      placeholder="0"
                      className={clsx(field, "num w-36 text-right")}
                      aria-label="Amount"
                    />
                  </td>
                  <td className="px-1 py-1 text-right">
                    {lines.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setLines((cur) => cur.filter((_, j) => j !== i))}
                        className="text-[11px] text-ink-faint hover:text-negative"
                        title="Remove this customer"
                      >
                        ×
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold text-ink">
                <td className="px-1 py-1.5">
                  <button
                    type="button"
                    onClick={() => setLines((cur) => [...cur, { customer: "", amount: "" }])}
                    className="text-[11.5px] font-medium text-navy hover:underline"
                  >
                    + Add a customer
                  </button>
                </td>
                <td className="num px-1 py-1.5 text-right">{money(draftTotal)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-[11px] text-ink-muted">
              Meeting date (Saturday)
              <input
                type="date"
                value={meeting}
                onChange={(e) => setMeeting(e.target.value)}
                className={clsx(field, "w-40")}
              />
            </label>
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="rounded-md bg-navy px-3 py-1.5 text-[12px] font-medium text-ink-invert hover:bg-navy-deep disabled:opacity-60"
            >
              {busy ? "Saving…" : row.hasCommitment ? "Update commitment" : "Save commitment"}
            </button>
          </div>
        </div>
      ) : row.lines.length > 0 ? (
        <table className="w-full max-w-3xl border-collapse text-[12px]">
          <thead>
            <tr className="text-ink-faint">
              <th scope="col" className="px-1 py-1 text-left font-medium">Customer</th>
              <th scope="col" className="px-1 py-1 text-right font-medium">Committed</th>
              <th scope="col" className="px-1 py-1 text-right font-medium">
                {measure === "revenue" ? "Billed in the week" : "Received in the week"}
              </th>
            </tr>
          </thead>
          <tbody>
            {row.lines.map((l, i) => (
              <tr key={i} className="text-ink">
                <td className="border-t border-line px-1 py-1.5">{l.customer}</td>
                <td className="num border-t border-line px-1 py-1.5 text-right">{money(l.amount)}</td>
                <td className="num border-t border-line px-1 py-1.5 text-right text-ink-muted">{money(l.actual)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold text-ink">
              <td className="border-t border-line-strong px-1 py-1.5">Total</td>
              <td className="num border-t border-line-strong px-1 py-1.5 text-right">{money(row.committed)}</td>
              <td className="num border-t border-line-strong px-1 py-1.5 text-right">
                {money(row.lines.reduce((s, l) => s + l.actual, 0))}
              </td>
            </tr>
          </tfoot>
        </table>
      ) : (
        <p className="text-[12px] text-ink-muted">
          {canCommit ? "Nothing was committed for this week." : "Nothing has been committed for this week yet."}
        </p>
      )}

      {row.locked && isAdmin && (
        <button
          type="button"
          onClick={() => post({ action: "reopen" }, "Reopened for today; it freezes again tonight.")}
          disabled={busy}
          className="rounded-md border border-line px-2.5 py-1 text-[11.5px] font-medium text-ink-muted hover:bg-surface-sunk disabled:opacity-60"
        >
          Reopen for today
        </button>
      )}

      {row.hasCommitment && canCommit && (
        <div className="flex flex-wrap items-end gap-3 border-t border-line pt-3">
          <label className="flex flex-col gap-1 text-[11px] text-ink-muted">
            Achieved?
            <select
              value={achieved}
              onChange={(e) => setAchieved(e.target.value)}
              className={clsx(field, "w-32")}
            >
              <option value="">—</option>
              <option value="yes">Yes</option>
              <option value="partly">Partly</option>
              <option value="no">No</option>
            </select>
          </label>
          <label className="flex min-w-[14rem] flex-1 flex-col gap-1 text-[11px] text-ink-muted">
            Remarks
            <input
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Anything worth saying about how the week went"
              className={field}
            />
          </label>
          <button
            type="button"
            onClick={() =>
              void post(
                { action: "outcome", achieved: achieved || null, remarks: remarks.trim() || null },
                "Outcome saved.",
              )
            }
            disabled={busy}
            className="rounded-md border border-line px-3 py-1.5 text-[12px] font-medium text-ink hover:bg-surface-sunk disabled:opacity-60"
          >
            Save outcome
          </button>
        </div>
      )}

      {error && <p className="text-[12px] text-negative">{error}</p>}
      {note && !error && <p className="text-[12px] text-positive">{note}</p>}
    </div>
  );
}

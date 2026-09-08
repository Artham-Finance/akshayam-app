"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import clsx from "clsx";
import { money, moneySigned } from "@/lib/format";
import type { DscTokenResult } from "@/lib/reports/dsc-token";

/**
 * DSC token stock-take: the books against the count in hand, for one month.
 *
 * Book value is the "DSC Asset Token" ledger balance at the month end and is
 * read-only. The book quantity and the physical count (qty and value) are
 * keyed in here - the month-end entry is posted once, so is this.
 */
export function DscTokenCard({
  result,
  verticalId,
}: {
  result: DscTokenResult;
  verticalId: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const pickMonth = (key: string) => {
    const next = new URLSearchParams(params.toString());
    next.set("dscm", key);
    startTransition(() => router.push(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  const [bookQty, setBookQty] = useState(result.bookQty);
  const [physQty, setPhysQty] = useState(result.physicalQty);
  const [physValue, setPhysValue] = useState(result.physicalValue);

  const qtyGap = physQty - bookQty;
  const valueGap = result.physicalValue - result.bookValue;

  const head =
    "border-y border-line px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-faint";
  const cell = "border-b border-line px-3 py-2";

  return (
    <div className="overflow-x-auto">
      <div className="flex flex-wrap items-center gap-2 px-4 pb-3 sm:px-5">
        <label className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-faint">
          Month
        </label>
        <select
          value={result.monthKey}
          disabled={pending}
          onChange={(e) => pickMonth(e.target.value)}
          className={clsx(
            "rounded-md border border-line bg-surface px-2 py-1 text-[12px] text-ink outline-none focus:border-navy",
            pending && "opacity-60",
          )}
        >
          {result.months.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>
        <span className="text-[11.5px] text-ink-muted">
          Book value is the ledger balance at month end; the quantities and the
          physical value are keyed in.
        </span>
      </div>

      <table className="w-full min-w-max border-collapse text-[13px]">
        <thead>
          <tr>
            <th scope="col" className={clsx(head, "text-left")}>
              Particulars
            </th>
            <th scope="col" className={clsx(head, "text-right")}>
              Quantity
            </th>
            <th scope="col" className={clsx(head, "text-right")}>
              Value
            </th>
          </tr>
        </thead>
        <tbody>
          <tr className="hover:bg-surface-sunk/40">
            <th scope="row" className={clsx(cell, "text-left font-normal text-ink")}>
              Token as per books
              <span className="mt-0.5 block text-[11px] font-normal text-ink-faint">
                DSC Asset Token account
              </span>
            </th>
            <td className={clsx(cell, "text-right")}>
              <NumCell
                value={bookQty}
                onCommit={(v) => {
                  setBookQty(v);
                  save({ bookQty: v, physicalQty: physQty, physicalValue: physValue });
                }}
              />
            </td>
            <td className={clsx(cell, "num text-right text-ink")}>{money(result.bookValue)}</td>
          </tr>
          <tr className="hover:bg-surface-sunk/40">
            <th scope="row" className={clsx(cell, "text-left font-normal text-ink")}>
              Actual token in hand (physical)
            </th>
            <td className={clsx(cell, "text-right")}>
              <NumCell
                value={physQty}
                onCommit={(v) => {
                  setPhysQty(v);
                  save({ bookQty, physicalQty: v, physicalValue: physValue });
                }}
              />
            </td>
            <td className={clsx(cell, "text-right")}>
              <NumCell
                value={physValue}
                onCommit={(v) => {
                  setPhysValue(v);
                  save({ bookQty, physicalQty: physQty, physicalValue: v });
                }}
              />
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr className="bg-surface-sunk font-semibold">
            <th scope="row" className="border-y border-line-strong px-3 py-2 text-left">
              Difference (physical less books)
            </th>
            <td
              className={clsx(
                "num border-y border-line-strong px-3 py-2 text-right",
                qtyGap < 0 ? "text-negative" : qtyGap > 0 ? "text-positive" : "text-ink-muted",
              )}
            >
              {qtyGap === 0 ? "—" : moneySigned(qtyGap)}
            </td>
            <td
              className={clsx(
                "num border-y border-line-strong px-3 py-2 text-right",
                Math.abs(valueGap) < 0.5
                  ? "text-ink-muted"
                  : valueGap < 0
                    ? "text-negative"
                    : "text-positive",
              )}
            >
              {Math.abs(valueGap) < 0.5 ? "—" : moneySigned(valueGap)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );

  async function save(fields: {
    bookQty: number;
    physicalQty: number;
    physicalValue: number;
  }) {
    try {
      await fetch("/api/dsc-token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ month: result.monthStart, verticalId, ...fields }),
      });
      startTransition(() => router.refresh());
    } catch {
      /* a failed save leaves the field as typed; the next edit retries */
    }
  }
}

/** An inline number field: plain text until focused, commits on blur if changed. */
function NumCell({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) return;
    const raw = draft.trim().replace(/[,\s₹]/g, "");
    setDraft(null);
    const next = raw === "" ? 0 : Number(raw);
    if (Number.isFinite(next) && next !== value) onCommit(next);
  };

  return (
    <input
      value={draft ?? (value ? String(value) : "")}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => {
        setDraft(value ? String(value) : "");
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
      placeholder="0"
      className="num w-28 rounded-md border border-line bg-surface px-2 py-1 text-right text-[12px] text-ink outline-none focus:border-navy"
    />
  );
}

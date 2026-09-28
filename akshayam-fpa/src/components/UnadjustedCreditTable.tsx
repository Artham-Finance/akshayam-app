"use client";

import { Fragment, useState } from "react";
import clsx from "clsx";
import { dateLabel, money, moneySigned } from "@/lib/format";
import type { UnadjustedCreditParty } from "@/lib/reports/unadjusted-credit";

/**
 * The unadjusted-credit book, one row per party, expanding to the postings
 * behind it.
 *
 * A party's total is a sum of many small receipts and reversals, so the
 * figure alone answers "how much" but not "is this real" - expanding is how
 * a reader checks a large balance against the actual entries rather than
 * taking the total on faith.
 */
export function UnadjustedCreditTable({ parties }: { parties: UnadjustedCreditParty[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (party: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(party)) next.delete(party);
      else next.add(party);
      return next;
    });

  const cell = "border-b border-line px-3 py-2";
  const head =
    "border-y border-line px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-faint";

  if (parties.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-[13px] text-ink-muted">
        Nothing unadjusted as at this date.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <div className="flex justify-end gap-2 px-4 pb-1 pt-4 text-[11.5px] sm:px-5">
        <button
          type="button"
          onClick={() => setOpen(new Set(parties.map((p) => p.party)))}
          className="text-ink-muted hover:text-navy"
        >
          Expand all
        </button>
        <span className="text-ink-faint">·</span>
        <button
          type="button"
          onClick={() => setOpen(new Set())}
          className="text-ink-muted hover:text-navy"
        >
          Collapse all
        </button>
      </div>

      <table className="w-full min-w-max border-collapse text-[13px]">
        <thead>
          <tr>
            <th scope="col" className={head}>
              Party
            </th>
            <th scope="col" className={clsx(head, "text-right")}>
              Postings
            </th>
            <th scope="col" className={clsx(head, "text-right")}>
              Latest
            </th>
            <th scope="col" className={clsx(head, "text-right")}>
              Unadjusted credit (INR)
            </th>
            <th scope="col" className={head} />
          </tr>
        </thead>
        <tbody>
          {parties.map((p) => {
            const isOpen = open.has(p.party);
            // Postings arrive newest first, so the first one is the latest.
            const latest = p.postings[0]?.txnDate ?? null;
            return (
              <Fragment key={p.party}>
                <tr className="hover:bg-surface-sunk/40">
                  <th scope="row" className={clsx(cell, "text-left font-normal text-ink")}>
                    <button
                      type="button"
                      onClick={() => toggle(p.party)}
                      aria-expanded={isOpen}
                      className="flex items-center gap-1.5 text-left hover:text-navy"
                    >
                      <span
                        className={clsx(
                          "text-[9px] text-ink-faint transition-transform",
                          isOpen && "rotate-90",
                        )}
                      >
                        ▶
                      </span>
                      {p.party}
                    </button>
                  </th>
                  <td className={clsx(cell, "num text-right text-ink-muted")}>
                    {p.postings.length}
                  </td>
                  <td className={clsx(cell, "num text-right text-ink-muted")}>
                    {latest ? dateLabel(latest) : "—"}
                  </td>
                  <td className={clsx(cell, "num text-right font-medium text-ink")}>
                    {money(p.total)}
                  </td>
                  <td className={clsx(cell, "text-right")}>
                    <button
                      type="button"
                      onClick={() => toggle(p.party)}
                      className="rounded-md border border-line px-2 py-0.5 text-[11.5px] font-medium text-ink-muted hover:bg-surface-sunk"
                    >
                      {isOpen ? "Close" : "Expand"}
                    </button>
                  </td>
                </tr>
                {isOpen && (
                  <tr>
                    <td colSpan={5} className="border-b border-line bg-surface-sunk/30 px-3 py-3 sm:px-6">
                      <table className="w-full border-collapse text-[12px]">
                        <thead>
                          <tr className="text-ink-faint">
                            <th scope="col" className="px-2 py-1 text-left font-medium">
                              Date
                            </th>
                            <th scope="col" className="px-2 py-1 text-left font-medium">
                              Reference
                            </th>
                            <th scope="col" className="px-2 py-1 text-right font-medium">
                              Debit
                            </th>
                            <th scope="col" className="px-2 py-1 text-right font-medium">
                              Credit
                            </th>
                            <th scope="col" className="px-2 py-1 text-right font-medium">
                              Amount
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {p.postings.map((posting) => (
                            <tr key={posting.id} className="text-ink">
                              <td className="num whitespace-nowrap border-t border-line px-2 py-1.5 text-ink-muted">
                                {dateLabel(posting.txnDate)}
                              </td>
                              <td className="border-t border-line px-2 py-1.5 text-ink-muted">
                                {posting.txnNumber ?? posting.reference ?? "—"}
                              </td>
                              <td className="num border-t border-line px-2 py-1.5 text-right">
                                {posting.debit ? money(posting.debit) : "—"}
                              </td>
                              <td className="num border-t border-line px-2 py-1.5 text-right">
                                {posting.credit ? money(posting.credit) : "—"}
                              </td>
                              <td className="num border-t border-line px-2 py-1.5 text-right font-medium">
                                {moneySigned(posting.amount)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
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

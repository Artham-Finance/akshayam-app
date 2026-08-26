"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { compactINR } from "@/lib/format";

/**
 * Vertical consolidation.
 *
 * Zoho reporting tags are free text and get renamed between years, so a single
 * vertical can arrive under several spellings. Each unrecognised tag is listed
 * with how much sits behind it, and folding it into a canonical vertical
 * repoints the history and remembers the decision for future uploads.
 */

export interface VerticalRow {
  id: number;
  code: string;
  name: string;
  needsReview: boolean;
  rows: number;
  activity: number;
}

export function VerticalMapper({ verticals }: { verticals: VerticalRow[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState<Record<number, string>>({});

  const canonical = useMemo(
    () => verticals.filter((v) => !v.needsReview).sort((a, b) => a.name.localeCompare(b.name)),
    [verticals],
  );
  const review = useMemo(
    () => verticals.filter((v) => v.needsReview).sort((a, b) => b.rows - a.rows),
    [verticals],
  );

  async function send(body: unknown, id: number) {
    setBusyId(id);
    setError(null);
    try {
      const response = await fetch("/api/verticals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error ?? "That change could not be saved.");
      } else {
        router.refresh();
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-5">
      {error && (
        <p className="rounded-card border border-negative/25 bg-negative-tint px-3 py-2 text-[12.5px] text-negative">
          {error}
        </p>
      )}

      <section>
        <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
          Needs a decision ({review.length})
        </h2>

        {review.length === 0 ? (
          <p className="rounded-card border border-positive/25 bg-positive-tint px-4 py-3 text-[13px] text-positive">
            Every reporting tag in the ledger maps to one of your verticals.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-card border border-line bg-surface">
            <table className="w-full min-w-max border-collapse text-[13px]">
              <thead>
                <tr>
                  {["Tag in Zoho", "Entries", "Activity", "Fold into"].map((label, i) => (
                    <th
                      key={label}
                      className={clsx(
                        "border-b border-line-strong px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-faint",
                        i === 1 || i === 2 ? "text-right" : "text-left",
                      )}
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {review.map((v) => (
                  <tr key={v.id} className="bg-caution-tint/40">
                    <td className="border-t border-line px-4 py-2.5 font-medium text-ink">
                      {v.name}
                    </td>
                    <td className="num border-t border-line px-4 py-2.5 text-right text-ink-muted">
                      {v.rows.toLocaleString("en-IN")}
                    </td>
                    <td className="num border-t border-line px-4 py-2.5 text-right text-ink-muted">
                      {compactINR(v.activity)}
                    </td>
                    <td className="border-t border-line px-4 py-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          value={choice[v.id] ?? ""}
                          disabled={busyId === v.id}
                          onChange={(e) =>
                            setChoice((c) => ({ ...c, [v.id]: e.target.value }))
                          }
                          className="w-56 rounded-md border border-line bg-surface px-2 py-1.5 text-[12.5px] text-ink"
                        >
                          <option value="">Choose a vertical…</option>
                          {canonical.map((target) => (
                            <option key={target.id} value={target.id}>
                              {target.code} — {target.name}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          disabled={busyId === v.id || !choice[v.id]}
                          onClick={() =>
                            void send(
                              {
                                action: "merge",
                                sourceId: v.id,
                                targetId: Number(choice[v.id]),
                              },
                              v.id,
                            )
                          }
                          className={clsx(
                            "rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors",
                            choice[v.id]
                              ? "bg-navy text-ink-invert hover:bg-navy-deep"
                              : "cursor-not-allowed bg-surface-sunk text-ink-faint",
                          )}
                        >
                          Merge
                        </button>
                        <button
                          type="button"
                          disabled={busyId === v.id}
                          onClick={() => void send({ action: "keep", id: v.id }, v.id)}
                          className="rounded-md border border-line px-2.5 py-1.5 text-[12px] font-medium text-ink-muted hover:border-line-strong hover:text-ink"
                        >
                          Keep as its own
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
          Your verticals ({canonical.length})
        </h2>
        <div className="overflow-x-auto rounded-card border border-line bg-surface">
          <table className="w-full min-w-max border-collapse text-[13px]">
            <thead>
              <tr>
                {["Code", "Vertical", "Entries", "Activity"].map((label, i) => (
                  <th
                    key={label}
                    className={clsx(
                      "border-b border-line-strong px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-faint",
                      i >= 2 ? "text-right" : "text-left",
                    )}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {canonical.map((v) => (
                <tr key={v.id}>
                  <td className="border-t border-line px-4 py-2.5 font-medium text-navy">
                    {v.code}
                  </td>
                  <td className="border-t border-line px-4 py-2.5 text-ink">{v.name}</td>
                  <td className="num border-t border-line px-4 py-2.5 text-right text-ink-muted">
                    {v.rows.toLocaleString("en-IN")}
                  </td>
                  <td className="num border-t border-line px-4 py-2.5 text-right text-ink-muted">
                    {v.activity ? compactINR(v.activity) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

"use client";

import { useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { DataTable } from "@/components/DataTable";
import { money } from "@/lib/format";

/**
 * Mapping Form 26AS deductors to customers.
 *
 * Only names that could not be joined mechanically appear at the top - the
 * mechanical matches need no attention and listing them would bury the ones
 * that do. Each row carries the tax at stake so the biggest are dealt with
 * first, and the TAN, which is the reliable way to identify a party when two
 * customers have similar names.
 */

export interface UnmatchedDeductor {
  deductorName: string;
  tan: string | null;
  lines: number;
  taxDeducted: number;
}

export interface ExistingAlias {
  deductorKey: string;
  customerName: string;
  lines: number;
  taxDeducted: number;
}

export function DeductorMapper({
  unmatched,
  aliases,
  customers,
}: {
  unmatched: UnmatchedDeductor[];
  aliases: ExistingAlias[];
  customers: string[];
}) {
  const router = useRouter();
  const listId = useId();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState<Record<string, string>>({});

  const customerSet = useMemo(() => new Set(customers), [customers]);
  const unmatchedTotal = unmatched.reduce((s, d) => s + d.taxDeducted, 0);
  const aliasTotal = aliases.reduce((s, a) => s + a.taxDeducted, 0);

  async function send(body: unknown, key: string) {
    setBusy(key);
    setError(null);
    try {
      const response = await fetch("/api/tds-deductors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error ?? "That mapping could not be saved.");
      } else {
        setChoice((c) => ({ ...c, [key]: "" }));
        router.refresh();
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      {/* One shared list of names, so every picker offers the same choices. */}
      <datalist id={listId}>
        {customers.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      {error && (
        <p className="rounded-card border border-negative/25 bg-negative-tint px-3 py-2 text-[12.5px] text-negative">
          {error}
        </p>
      )}

      <section>
        <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
          Needs a customer ({unmatched.length})
        </h2>

        {unmatched.length === 0 ? (
          <p className="rounded-card border border-positive/25 bg-positive-tint px-4 py-3 text-[13px] text-positive">
            Every deductor in Form 26AS is matched to a customer.
          </p>
        ) : (
          <div className="rounded-card border border-line bg-surface">
            <DataTable
              columns={[
                { header: "Deductor per Form 26AS" },
                { header: "TAN" },
                { header: "Lines", numeric: true },
                { header: "TDS", numeric: true, strong: true },
                { header: "Map to customer" },
              ]}
              rows={unmatched.map((d) => [
                <span key="n" className="font-medium text-ink">
                  {d.deductorName}
                </span>,
                <span key="t" className="num text-ink-faint">
                  {d.tan ?? "—"}
                </span>,
                d.lines,
                money(d.taxDeducted),
                <div key="m" className="flex flex-wrap items-center gap-2">
                  <input
                    list={listId}
                    value={choice[d.deductorName] ?? ""}
                    disabled={busy === d.deductorName}
                    placeholder="Start typing a customer…"
                    onChange={(e) =>
                      setChoice((c) => ({ ...c, [d.deductorName]: e.target.value }))
                    }
                    className="w-64 rounded-md border border-line bg-surface px-2 py-1.5 text-[12.5px] text-ink"
                  />
                  <button
                    type="button"
                    disabled={busy === d.deductorName || !customerSet.has(choice[d.deductorName] ?? "")}
                    onClick={() =>
                      void send(
                        {
                          action: "map",
                          deductorName: d.deductorName,
                          customerName: choice[d.deductorName],
                        },
                        d.deductorName,
                      )
                    }
                    className={clsx(
                      "rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors",
                      customerSet.has(choice[d.deductorName] ?? "")
                        ? "bg-navy text-ink-invert hover:bg-navy-deep"
                        : "cursor-not-allowed bg-surface-sunk text-ink-faint",
                    )}
                  >
                    {busy === d.deductorName ? "Saving…" : "Map"}
                  </button>
                </div>,
              ])}
              footer={[
                `Total — ${unmatched.length} deductor${unmatched.length === 1 ? "" : "s"}`,
                "",
                unmatched.reduce((s, d) => s + d.lines, 0),
                money(unmatchedTotal),
                "",
              ]}
            />
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
          Mapped by hand ({aliases.length})
        </h2>

        {aliases.length === 0 ? (
          <p className="rounded-card border border-line bg-surface px-4 py-3 text-[13px] text-ink-muted">
            Nothing mapped by hand yet. Names joined automatically are not listed here &mdash;
            only decisions someone made.
          </p>
        ) : (
          <div className="rounded-card border border-line bg-surface">
            <DataTable
              columns={[
                { header: "Deductor (normalised)" },
                { header: "Mapped to customer" },
                { header: "Lines", numeric: true },
                { header: "TDS", numeric: true, strong: true },
                { header: "" },
              ]}
              rows={aliases.map((a) => [
                <span key="k" className="text-ink-muted">
                  {a.deductorKey}
                </span>,
                <span key="c" className="font-medium text-ink">
                  {a.customerName}
                </span>,
                a.lines,
                money(a.taxDeducted),
                <button
                  key="x"
                  type="button"
                  disabled={busy === a.deductorKey}
                  onClick={() =>
                    void send({ action: "unmap", deductorKey: a.deductorKey }, a.deductorKey)
                  }
                  className="rounded-md border border-line px-2.5 py-1 text-[12px] font-medium text-ink-muted hover:border-negative/40 hover:text-negative"
                >
                  {busy === a.deductorKey ? "Removing…" : "Remove"}
                </button>,
              ])}
              footer={[
                `Total — ${aliases.length} mapping${aliases.length === 1 ? "" : "s"}`,
                "",
                aliases.reduce((s, a) => s + a.lines, 0),
                money(aliasTotal),
                "",
              ]}
            />
          </div>
        )}
      </section>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { compactINR } from "@/lib/format";

/**
 * Chart-of-accounts mapping.
 *
 * Accounts that could not be classified confidently are pinned to the top,
 * because an unmapped account is money missing from the statements and that
 * should be impossible to overlook.
 */

export interface AccountRow {
  id: number;
  name: string;
  zohoType: string | null;
  statement: "pnl" | "bs" | "cf" | "none";
  groupCode: string | null;
  isMapped: boolean;
  /** absolute movement in the ledger, used to sort by materiality */
  activity: number;
}

export interface GroupOption {
  statement: "pnl" | "bs";
  code: string;
  name: string;
}

export function AccountMapper({
  accounts,
  groups,
}: {
  accounts: AccountRow[];
  groups: GroupOption[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState(accounts);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"needs" | "all">(
    accounts.some((a) => !a.isMapped) ? "needs" : "all",
  );

  const pnlGroups = useMemo(() => groups.filter((g) => g.statement === "pnl"), [groups]);
  const bsGroups = useMemo(() => groups.filter((g) => g.statement === "bs"), [groups]);

  const visible = useMemo(() => {
    const list = filter === "needs" ? rows.filter((r) => !r.isMapped) : rows;
    return [...list].sort((a, b) => {
      if (a.isMapped !== b.isMapped) return a.isMapped ? 1 : -1;
      return b.activity - a.activity;
    });
  }, [rows, filter]);

  const unmappedCount = rows.filter((r) => !r.isMapped).length;

  async function save(id: number, statement: AccountRow["statement"], groupCode: string | null) {
    setSavingId(id);
    setError(null);

    const previous = rows;
    setRows((current) =>
      current.map((row) =>
        row.id === id ? { ...row, statement, groupCode, isMapped: true } : row,
      ),
    );

    try {
      const response = await fetch("/api/accounts", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, statement, groupCode }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setRows(previous);
        setError(data.error ?? "Could not save that change.");
      } else {
        router.refresh();
      }
    } catch {
      setRows(previous);
      setError("Could not reach the server.");
    } finally {
      setSavingId(null);
    }
  }

  /** One select drives both statement and line, since "Revenue" implies the P&L. */
  function handleChange(row: AccountRow, value: string) {
    if (value === "none") {
      void save(row.id, "none", null);
      return;
    }
    const [statement, code] = value.split(":") as ["pnl" | "bs", string];
    void save(row.id, statement, code);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-md border border-line p-0.5">
          {(["needs", "all"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setFilter(option)}
              className={clsx(
                "rounded px-2.5 py-1.5 text-[12px] font-medium transition-colors",
                filter === option ? "bg-navy text-ink-invert" : "text-ink-muted hover:text-ink",
              )}
            >
              {option === "needs" ? `Needs review (${unmappedCount})` : `All accounts (${rows.length})`}
            </button>
          ))}
        </div>
        {savingId !== null && <span className="text-[12px] text-ink-faint">Saving…</span>}
      </div>

      {error && (
        <p className="rounded-card border border-negative/25 bg-negative-tint px-3 py-2 text-[12.5px] text-negative">
          {error}
        </p>
      )}

      {visible.length === 0 ? (
        <p className="rounded-card border border-positive/25 bg-positive-tint px-4 py-3 text-[13px] text-positive">
          Every account with activity is mapped. The statements include all of the ledger.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-card border border-line bg-surface">
          <table className="w-full min-w-max border-collapse text-[13px]">
            <thead>
              <tr>
                {["Ledger account", "Zoho type", "Activity", "Reported under"].map((label, i) => (
                  <th
                    key={label}
                    className={clsx(
                      "border-b border-line-strong px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-faint",
                      i === 2 ? "text-right" : "text-left",
                    )}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id} className={clsx(!row.isMapped && "bg-caution-tint/50")}>
                  <td className="border-t border-line px-4 py-2.5">
                    <span className="font-medium text-ink">{row.name}</span>
                    {!row.isMapped && (
                      <span className="ml-2 rounded-full bg-caution/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-caution">
                        check
                      </span>
                    )}
                  </td>
                  <td className="border-t border-line px-4 py-2.5 text-ink-muted">
                    {row.zohoType ?? "—"}
                  </td>
                  <td className="num border-t border-line px-4 py-2.5 text-right text-ink-muted">
                    {row.activity ? compactINR(row.activity) : "—"}
                  </td>
                  <td className="border-t border-line px-4 py-2.5">
                    <select
                      value={row.statement === "none" ? "none" : `${row.statement}:${row.groupCode}`}
                      onChange={(e) => handleChange(row, e.target.value)}
                      disabled={savingId === row.id}
                      className="w-64 rounded-md border border-line bg-surface px-2 py-1.5 text-[12.5px] text-ink"
                    >
                      <option value="none">Excluded from statements</option>
                      <optgroup label="Profit & Loss">
                        {pnlGroups.map((group) => (
                          <option key={group.code} value={`pnl:${group.code}`}>
                            {group.name}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="Balance Sheet">
                        {bsGroups.map((group) => (
                          <option key={group.code} value={`bs:${group.code}`}>
                            {group.name}
                          </option>
                        ))}
                      </optgroup>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

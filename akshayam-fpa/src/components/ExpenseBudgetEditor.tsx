"use client";

import { Fragment, useState } from "react";
import clsx from "clsx";
import { money } from "@/lib/format";
import type { FyMonth } from "@/lib/period";

/** One budget line, its twelve months keyed by "YYYY-MM". */
export interface BudgetLineRow {
  head: string;
  label: string;
  months: Record<string, { id: number; amount: number } | undefined>;
}

/**
 * A spreadsheet-shaped grid of one entity's expense budget, editable cell by
 * cell.
 *
 * Each cell saves itself on blur, the same "one at a time" idea the
 * Other-expenses entry form uses - a grid this size makes a single "save
 * everything" button risk losing an earlier edit to a later mistake, where a
 * per-cell save only ever risks the one cell being typed into.
 *
 * Lines are grouped under their head, collapsed by default - the same
 * shape ExpenseDetailTable uses for the same reason: fourteen heads read
 * better than every line at once.
 */
export function ExpenseBudgetEditor({
  lines,
  months,
}: {
  lines: BudgetLineRow[];
  months: FyMonth[];
}) {
  const groups: { head: string; lines: BudgetLineRow[] }[] = [];
  const index = new Map<string, number>();
  for (const line of lines) {
    if (!index.has(line.head)) {
      index.set(line.head, groups.length);
      groups.push({ head: line.head, lines: [] });
    }
    groups[index.get(line.head)!].lines.push(line);
  }

  const [openHeads, setOpenHeads] = useState<Set<string>>(new Set());
  const toggle = (head: string) =>
    setOpenHeads((cur) => {
      const next = new Set(cur);
      if (next.has(head)) next.delete(head);
      else next.add(head);
      return next;
    });

  const head = "border-y border-line px-2 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint";

  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full min-w-max border-collapse text-[13px]">
        <thead>
          <tr>
            <th scope="col" className={clsx(head, "text-left")}>
              Particulars
            </th>
            {months.map((m) => (
              <th key={m.key} scope="col" className={clsx(head, "text-right")}>
                {m.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const open = g.lines.length === 1 || openHeads.has(g.head);
            const single = g.lines.length === 1;
            return (
              <Fragment key={g.head}>
                {!single && (
                  <tr key={`${g.head}-head`} className="bg-surface-sunk/60">
                    <th scope="row" className="border-b border-line px-2 py-1.5 text-left">
                      <button
                        type="button"
                        onClick={() => toggle(g.head)}
                        className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted hover:text-ink"
                      >
                        <span className={clsx("text-[9px] transition-transform", open && "rotate-90")}>
                          ▶
                        </span>
                        {g.head}
                        <span className="font-normal normal-case tracking-normal text-ink-faint">
                          {g.lines.length} lines
                        </span>
                      </button>
                    </th>
                    {months.map((m) => (
                      <td key={m.key} className="border-b border-line px-2 py-1.5" />
                    ))}
                  </tr>
                )}
                {open &&
                  g.lines.map((line) => (
                    <LineRow key={`${line.head}|${line.label}`} line={line} months={months} indent={!single} />
                  ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function LineRow({
  line,
  months,
  indent,
}: {
  line: BudgetLineRow;
  months: FyMonth[];
  indent: boolean;
}) {
  const cell = "border-b border-line px-2 py-1.5";

  return (
    <tr className="hover:bg-surface-sunk/40">
      <th
        scope="row"
        className={clsx(cell, "text-left font-normal text-ink", indent && "pl-6")}
      >
        {line.label}
      </th>
      {months.map((m) => {
        const cellValue = line.months[m.key];
        return (
          <td key={m.key} className={clsx(cell, "p-0")}>
            {cellValue ? (
              <BudgetCell id={cellValue.id} amount={cellValue.amount} />
            ) : (
              <div className="px-2 py-1.5 text-right text-ink-faint">—</div>
            )}
          </td>
        );
      })}
    </tr>
  );
}

function BudgetCell({ id, amount }: { id: number; amount: number }) {
  const [value, setValue] = useState(String(amount));
  const [saved, setSaved] = useState(amount);
  const [focused, setFocused] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const commit = async () => {
    setFocused(false);
    const raw = value.trim().replace(/[,\s₹]/g, "");
    const parsed = raw === "" ? 0 : Number(raw);
    if (!Number.isFinite(parsed) || parsed === saved) {
      setValue(String(saved));
      return;
    }
    setStatus("saving");
    try {
      const response = await fetch("/api/expense-budget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, amount: parsed }),
      });
      if (!response.ok) {
        setStatus("error");
        setValue(String(saved));
        return;
      }
      setSaved(parsed);
      setValue(String(parsed));
      setStatus("saved");
      setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 1500);
    } catch {
      setStatus("error");
      setValue(String(saved));
    }
  };

  return (
    <div className="relative">
      <input
        value={focused ? value : money(saved)}
        onFocus={(e) => {
          setFocused(true);
          setValue(String(saved));
          // Select-all on focus, so typing a new figure replaces rather than
          // appends. The node is captured now, not read off the (pooled)
          // event inside the callback, which is null by the time it runs.
          const node = e.currentTarget;
          requestAnimationFrame(() => node.select());
        }}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setValue(String(saved));
            e.currentTarget.blur();
          }
        }}
        disabled={status === "saving"}
        inputMode="decimal"
        className={clsx(
          "num w-full bg-transparent px-2 py-1.5 text-right outline-none",
          "focus:bg-navy/5 focus:ring-1 focus:ring-inset focus:ring-navy",
          status === "error" && "bg-negative/10 text-negative",
        )}
      />
      {status === "saved" && (
        <span className="pointer-events-none absolute right-1 top-1 text-[10px] text-positive">✓</span>
      )}
    </div>
  );
}

"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import clsx from "clsx";

/** FY / quarter / this-quarter-or-cumulative pickers, written to the query string. */
export function ScorecardControls({
  financialYears,
  currentFy,
  currentQuarter,
  cumulative,
}: {
  financialYears: number[];
  currentFy: number;
  currentQuarter: number;
  cumulative: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) next.set(k, v);
    startTransition(() => router.push(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  const cls =
    "rounded-md border border-line bg-surface px-2.5 py-1.5 text-[12px] font-medium text-ink";

  return (
    <div className={clsx("flex flex-wrap items-center gap-2", pending && "opacity-60")}>
      {financialYears.length > 0 && (
        <label className="flex items-center gap-2 text-[12px] text-ink-muted">
          <span className="sr-only sm:not-sr-only">Year</span>
          <select value={currentFy} onChange={(e) => set({ fy: e.target.value })} className={cls}>
            {financialYears.map((y) => (
              <option key={y} value={y}>{`FY ${y}-${String(y + 1).slice(2)}`}</option>
            ))}
          </select>
        </label>
      )}
      <label className="flex items-center gap-2 text-[12px] text-ink-muted">
        <span className="sr-only sm:not-sr-only">Quarter</span>
        <select value={currentQuarter} onChange={(e) => set({ q: e.target.value })} className={cls}>
          <option value={1}>Q1 · Apr–Jun</option>
          <option value={2}>Q2 · Jul–Sep</option>
          <option value={3}>Q3 · Oct–Dec</option>
          <option value={4}>Q4 · Jan–Mar</option>
        </select>
      </label>
      <label className="flex items-center gap-2 text-[12px] text-ink-muted">
        <span className="sr-only sm:not-sr-only">Basis</span>
        <select
          value={cumulative ? "cumulative" : "quarter"}
          onChange={(e) => set({ basis: e.target.value })}
          className={cls}
        >
          <option value="quarter">This quarter</option>
          <option value="cumulative">Cumulative to quarter</option>
        </select>
      </label>
    </div>
  );
}

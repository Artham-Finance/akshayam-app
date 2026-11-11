"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import clsx from "clsx";

/**
 * The two pickers of Trend Analysis → Performance: the financial year, and the period inside it
 * (a month, a quarter ended, a half year ended, or the whole year). They write to the query
 * string, so one comparison is a link that can be sent.
 */
export function PerformanceControls({
  financialYears,
  fyStartYear,
  period,
  options,
}: {
  financialYears: number[];
  fyStartYear: number;
  /** the period picked, as its picker value ("m7", "q2", "h1", "fy") */
  period: string;
  options: { group: string; options: { value: string; label: string }[] }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    next.set("tab", "performance");
    next.set(key, value);
    startTransition(() => router.push(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  const field =
    "rounded-md border border-line bg-surface px-2.5 py-1.5 text-[12.5px] font-medium text-ink";

  return (
    <div className={clsx("flex flex-wrap items-end gap-3", pending && "opacity-60")}>
      <label className="flex flex-col gap-1 text-[11px] text-ink-muted">
        Financial year
        <select value={fyStartYear} onChange={(e) => update("fy", e.target.value)} className={clsx(field, "w-36")}>
          {financialYears.map((y) => (
            <option key={y} value={y}>
              {`FY ${y}-${String(y + 1).slice(2)}`}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-[11px] text-ink-muted">
        Period
        <select value={period} onChange={(e) => update("period", e.target.value)} className={clsx(field, "w-64")}>
          {options.map((g) => (
            <optgroup key={g.group} label={g.group}>
              {g.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <span className="pb-1.5 text-[11.5px] text-ink-faint">
        compared with the same period of each earlier year
      </span>
    </div>
  );
}

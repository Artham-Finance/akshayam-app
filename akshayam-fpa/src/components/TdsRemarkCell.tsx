"use client";

import { useState } from "react";
import clsx from "clsx";

/**
 * Why a TDS entry is not in Zoho, or whatever else explains a customer's
 * gap - free text, saved on blur. A "ret_only" customer has no invoice for
 * a reader to point at instead, so this is the only trace of the reason.
 */
export function TdsRemarkCell({
  fyStartYear,
  quarter,
  customer,
  initialValue,
}: {
  fyStartYear: number;
  quarter: number;
  customer: string;
  initialValue: string | null;
}) {
  const [value, setValue] = useState(initialValue ?? "");
  const [saved, setSaved] = useState(initialValue ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const commit = async () => {
    const clean = value.trim();
    if (clean === saved.trim()) return;
    setBusy(true);
    setError(false);
    try {
      const response = await fetch("/api/tds-remark", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fyStartYear, quarter, customer, remark: clean }),
      });
      if (!response.ok) throw new Error();
      setSaved(clean);
      setValue(clean);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      disabled={busy}
      placeholder="Why it's not in Zoho…"
      title={error ? "Could not save - try again" : undefined}
      className={clsx(
        "w-full min-w-[14rem] rounded-md border px-2 py-1 text-[12px] text-ink outline-none placeholder:text-ink-faint disabled:opacity-60",
        error ? "border-negative" : "border-transparent bg-transparent hover:border-line focus:border-navy focus:bg-surface",
      )}
    />
  );
}

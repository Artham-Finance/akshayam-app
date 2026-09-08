"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import clsx from "clsx";
import { PRESET_LABEL, type PeriodCookie, type PresetId } from "@/lib/period-presets";

/**
 * The global reporting-period picker: presets plus a custom calendar range,
 * held in a cookie so the choice follows the reader from tab to tab. Same
 * interaction as the company switcher beside it - POST, then a soft refresh.
 *
 * The calendar only offers days inside the current financial year: the whole
 * reporting engine is built one year at a time, so a range crossing 1 April is
 * not something the statements can express.
 */

const CURRENT: PresetId[] = [
  "today",
  "this_week",
  "this_month",
  "mtd",
  "this_quarter",
  "qtd",
  "this_year",
  "ytd",
];
const PREVIOUS: PresetId[] = [
  "prev_day",
  "prev_week",
  "prev_month",
  "prev_quarter",
  "prev_year",
];

export function PeriodPicker({
  current,
  currentLabel,
  fyBounds,
}: {
  current: PeriodCookie;
  currentLabel: string;
  /** first and last day of the financial year the picker is confined to */
  fyBounds: { start: string; end: string };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [showCal, setShowCal] = useState(current.preset === "custom");
  const box = useRef<HTMLDivElement>(null);

  const fyStart = fyBounds.start;
  const fyEnd = fyBounds.end;

  const [from, setFrom] = useState<string | null>(current.from ?? null);
  const [to, setTo] = useState<string | null>(current.to ?? null);
  const [calMonth, setCalMonth] = useState<Date>(() =>
    startOfMonth(parseISO(current.from ?? clampIntoFy(todayIso(), fyStart, fyEnd))),
  );

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function apply(body: PeriodCookie) {
    setBusy(true);
    try {
      await fetch("/api/reporting-period", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      setOpen(false);
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  const disabled = busy || pending;

  const pickDay = (iso: string) => {
    if (iso < fyStart || iso > fyEnd) return;
    if (!from || (from && to)) {
      setFrom(iso);
      setTo(null);
    } else if (iso < from) {
      setTo(from);
      setFrom(iso);
    } else {
      setTo(iso);
    }
  };

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          "flex w-full items-center gap-1.5 truncate rounded-md border border-line bg-surface px-2 py-1.5 text-[12px] font-medium text-ink sm:w-auto sm:max-w-[220px]",
          disabled && "opacity-60",
        )}
      >
        <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5 shrink-0 text-ink-faint">
          <path
            d="M6 2v3M14 2v3M3 8h14M4 4h12a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
        <span className="truncate">{currentLabel}</span>
        <svg viewBox="0 0 20 20" fill="currentColor" className="ml-auto h-3 w-3 shrink-0 text-ink-faint">
          <path d="M5 7l5 5 5-5H5Z" />
        </svg>
      </button>

      {open && (
        <div
          role="dialog"
          className="absolute right-0 z-40 mt-1 w-[260px] rounded-lg border border-line bg-surface p-2 shadow-lg"
        >
          <PresetGroup
            title="Current"
            ids={CURRENT}
            current={current}
            disabled={disabled}
            onPick={(id) => apply({ preset: id })}
          />
          <PresetGroup
            title="Previous"
            ids={PREVIOUS}
            current={current}
            disabled={disabled}
            onPick={(id) => apply({ preset: id })}
          />

          <button
            type="button"
            onClick={() => setShowCal((v) => !v)}
            className={clsx(
              "mt-1 flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[12px] font-medium",
              current.preset === "custom"
                ? "bg-navy text-ink-invert"
                : "text-ink hover:bg-surface-sunk",
            )}
          >
            Custom range…
            <span className="text-[10px]">{showCal ? "▲" : "▼"}</span>
          </button>

          {showCal && (
            <div className="mt-2 border-t border-line pt-2">
              <div className="mb-1.5 flex items-center justify-between px-1">
                <button
                  type="button"
                  onClick={() => setCalMonth((m) => subMonths(m, 1))}
                  disabled={calMonth <= startOfMonth(parseISO(fyStart))}
                  className="rounded px-1.5 text-[13px] text-ink-muted hover:bg-surface-sunk disabled:opacity-30"
                >
                  ‹
                </button>
                <span className="text-[11px] font-semibold text-ink">
                  {format(calMonth, "MMMM yyyy")}
                </span>
                <button
                  type="button"
                  onClick={() => setCalMonth((m) => addMonths(m, 1))}
                  disabled={endOfMonth(calMonth) >= parseISO(fyEnd)}
                  className="rounded px-1.5 text-[13px] text-ink-muted hover:bg-surface-sunk disabled:opacity-30"
                >
                  ›
                </button>
              </div>

              <MonthGrid
                month={calMonth}
                from={from}
                to={to}
                fyStart={fyStart}
                fyEnd={fyEnd}
                onPick={pickDay}
              />

              <div className="mt-2 flex items-center justify-between px-1">
                <span className="text-[10.5px] text-ink-faint">
                  {from ? fmt(from) : "start"} – {to ? fmt(to) : "end"}
                </span>
                <button
                  type="button"
                  disabled={!from || !to || disabled}
                  onClick={() => from && to && apply({ preset: "custom", from, to })}
                  className="rounded-md bg-navy px-2.5 py-1 text-[11.5px] font-semibold text-ink-invert hover:bg-navy-deep disabled:opacity-40"
                >
                  Apply
                </button>
              </div>
              <p className="mt-1 px-1 text-[10px] text-ink-faint">
                One financial year at a time.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PresetGroup({
  title,
  ids,
  current,
  disabled,
  onPick,
}: {
  title: string;
  ids: PresetId[];
  current: PeriodCookie;
  disabled: boolean;
  onPick: (id: PresetId) => void;
}) {
  return (
    <div className="mb-1">
      <p className="px-2 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
        {title}
      </p>
      <div className="grid grid-cols-2 gap-0.5">
        {ids.map((id) => (
          <button
            key={id}
            type="button"
            disabled={disabled}
            onClick={() => onPick(id)}
            className={clsx(
              "rounded-md px-2 py-1 text-left text-[11.5px]",
              current.preset === id
                ? "bg-navy font-semibold text-ink-invert"
                : "text-ink hover:bg-surface-sunk",
            )}
          >
            {PRESET_LABEL[id as Exclude<PresetId, "custom">]}
          </button>
        ))}
      </div>
    </div>
  );
}

function MonthGrid({
  month,
  from,
  to,
  fyStart,
  fyEnd,
  onPick,
}: {
  month: Date;
  from: string | null;
  to: string | null;
  fyStart: string;
  fyEnd: string;
  onPick: (iso: string) => void;
}) {
  const days = useMemo(
    () =>
      eachDayOfInterval({
        start: startOfWeek(startOfMonth(month), { weekStartsOn: 1 }),
        end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 }),
      }),
    [month],
  );

  return (
    <div className="grid grid-cols-7 gap-y-0.5 text-center">
      {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
        <span key={i} className="text-[9px] font-semibold text-ink-faint">
          {d}
        </span>
      ))}
      {days.map((d) => {
        const iso = format(d, "yyyy-MM-dd");
        const outOfFy = iso < fyStart || iso > fyEnd;
        const outOfMonth = !isSameMonth(d, month);
        const isEnd = iso === from || iso === to;
        const inRange = from && to && iso > from && iso < to;
        return (
          <button
            key={iso}
            type="button"
            disabled={outOfFy}
            onClick={() => onPick(iso)}
            className={clsx(
              "mx-auto flex h-6 w-6 items-center justify-center rounded text-[10.5px]",
              outOfFy && "cursor-not-allowed text-ink-faint/40",
              !outOfFy && outOfMonth && "text-ink-faint",
              !outOfFy && !outOfMonth && !isEnd && !inRange && "text-ink hover:bg-surface-sunk",
              inRange && "bg-navy-tint text-navy",
              isEnd && "bg-navy font-semibold text-ink-invert",
            )}
          >
            {d.getDate()}
          </button>
        );
      })}
    </div>
  );
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}
function clampIntoFy(iso: string, start: string, end: string) {
  return iso < start ? start : iso > end ? end : iso;
}
const fmt = (iso: string) => format(parseISO(iso), "d MMM yyyy");

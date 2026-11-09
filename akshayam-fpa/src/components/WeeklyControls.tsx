"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import clsx from "clsx";
import { isValidDate, type MeetingWeek } from "@/lib/weekly";

/**
 * The pickers at the head of the screen: the meeting, the week ended, and - where more
 * than one vertical is in view - the vertical, which narrows every tab to it.
 * Choosing a week moves the meeting to the Saturday before it begins - where its
 * commitment is normally made - and a meeting date picked by hand stays as it is,
 * on any day: management may meet on the Friday when the Saturday is a holiday.
 */
export function WeeklyControls({
  weeks,
  weekEnd,
  meetingDate,
  measure,
  verticals,
  verticalId,
}: {
  weeks: MeetingWeek[];
  weekEnd: string;
  meetingDate: string;
  measure: string;
  verticals: { id: number; name: string }[];
  /** the vertical picked, or null for all of them */
  verticalId: number | null;
}) {
  const router = useRouter();
  const [problem, setProblem] = useState<string | null>(null);

  const go = (next: { week?: string; meeting?: string | null; vertical?: number | null }) => {
    const params = new URLSearchParams();
    params.set("measure", measure);
    params.set("week", next.week ?? weekEnd);
    if (next.meeting !== null && (next.meeting ?? meetingDate)) {
      params.set("meeting", next.meeting ?? meetingDate);
    }
    // The vertical stays picked as the week or the meeting changes.
    const vertical = next.vertical === undefined ? verticalId : next.vertical;
    if (vertical !== null) params.set("vertical", String(vertical));
    router.push(`/weekly-ratings?${params.toString()}`);
  };

  const field =
    "rounded-md border border-line bg-surface px-2 py-1.5 text-[12.5px] text-ink";

  return (
    <div className="flex flex-wrap items-end gap-4">
      <label className="flex flex-col gap-1 text-[11px] text-ink-muted">
        Weekly meeting date
        <input
          type="date"
          value={meetingDate}
          onChange={(e) => {
            const value = e.target.value;
            if (!value) return;
            if (!isValidDate(value)) {
              setProblem("Pick a valid date for the meeting.");
              return;
            }
            setProblem(null);
            go({ meeting: value });
          }}
          className={clsx(field, "w-44")}
        />
      </label>
      <label className="flex flex-col gap-1 text-[11px] text-ink-muted">
        Week ended
        <select
          value={weekEnd}
          onChange={(e) => {
            setProblem(null);
            go({ week: e.target.value, meeting: null });
          }}
          className={clsx(field, "w-64")}
        >
          {weeks.map((w) => (
            <option key={w.end} value={w.end}>
              {w.label}
            </option>
          ))}
        </select>
      </label>
      {/* One vertical in view means "all verticals" is that vertical - nothing to pick. */}
      {verticals.length > 1 && (
        <label className="flex flex-col gap-1 text-[11px] text-ink-muted">
          Vertical
          <select
            value={verticalId ?? ""}
            onChange={(e) => {
              setProblem(null);
              go({ vertical: e.target.value ? Number(e.target.value) : null });
            }}
            className={clsx(field, "w-64")}
          >
            <option value="">All verticals</option>
            {verticals.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {problem && <span className="pb-1.5 text-[12px] text-negative">{problem}</span>}
    </div>
  );
}

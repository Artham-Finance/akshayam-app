"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import clsx from "clsx";
import { isSaturday, type MeetingWeek } from "@/lib/weekly";

/**
 * The two pickers at the head of the screen: the Saturday meeting, and the week
 * ended. Choosing a week moves the meeting to the Saturday before it begins -
 * where its commitment is normally made - and a meeting date picked by hand
 * stays as it is, since a commitment can be taken at any Saturday meeting.
 */
export function WeeklyControls({
  weeks,
  weekEnd,
  meetingDate,
  measure,
}: {
  weeks: MeetingWeek[];
  weekEnd: string;
  meetingDate: string;
  measure: string;
}) {
  const router = useRouter();
  const [problem, setProblem] = useState<string | null>(null);

  const go = (next: { week?: string; meeting?: string | null }) => {
    const params = new URLSearchParams();
    params.set("measure", measure);
    params.set("week", next.week ?? weekEnd);
    if (next.meeting !== null && (next.meeting ?? meetingDate)) {
      params.set("meeting", next.meeting ?? meetingDate);
    }
    router.push(`/weekly-ratings?${params.toString()}`);
  };

  const field =
    "rounded-md border border-line bg-surface px-2 py-1.5 text-[12.5px] text-ink";

  return (
    <div className="flex flex-wrap items-end gap-4">
      <label className="flex flex-col gap-1 text-[11px] text-ink-muted">
        Weekly meeting date (Saturday)
        <input
          type="date"
          value={meetingDate}
          onChange={(e) => {
            const value = e.target.value;
            if (!value) return;
            if (!isSaturday(value)) {
              setProblem("The weekly meeting is on a Saturday - pick a Saturday.");
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
      {problem && <span className="pb-1.5 text-[12px] text-negative">{problem}</span>}
    </div>
  );
}

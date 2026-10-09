import Link from "next/link";
import clsx from "clsx";
import { SetupRequired } from "@/components/SetupRequired";
import { WeeklyControls } from "@/components/WeeklyControls";
import { WeeklyRatingsTable } from "@/components/WeeklyRatingsTable";
import { Card, CardTitle, EmptyState, Notice, PageHeader } from "@/components/ui";
import { getEntity } from "@/lib/entity";
import { dateLabel } from "@/lib/format";
import { getCurrentUser, requireEntityAccess } from "@/lib/auth/dal";
import { buildWeeklyRatings } from "@/lib/reports/weekly-ratings";
import {
  WEEKLY_MEASURES,
  WEEKLY_MEASURE_LABEL,
  defaultMeetingDate,
  defaultWeekEnd,
  isSaturday,
  meetingWeeks,
  todayIst,
  type WeeklyMeasure,
} from "@/lib/weekly";

export const dynamic = "force-dynamic";

/**
 * Weekly ratings - the Saturday meeting's commitments and how they landed.
 *
 * Each vertical head commits, before the week begins, what they will bring in:
 * revenue, collection, or receivables recovered, customer by customer. The
 * week is then rated on what was actually achieved against that commitment, on
 * the Vertical Performance Scorecard's own bands, beside the weekly budget, the
 * ledger's actual, and the vertical's scorecard for the quarter. The amounts
 * freeze at the end of the day they are keyed.
 */
export default async function WeeklyRatingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireEntityAccess();
  const params = await searchParams;
  const pick = (v: string | string[] | undefined) => (typeof v === "string" ? v : null);

  try {
    const entity = await getEntity();
    const user = await getCurrentUser();

    const weeks = meetingWeeks();
    const today = todayIst();
    const requestedWeek = pick(params.week);
    const weekEnd =
      requestedWeek && weeks.some((w) => w.end === requestedWeek)
        ? requestedWeek
        : weeks.find((w) => w.end === defaultWeekEnd(today))?.end ?? weeks[0].end;
    const requestedMeeting = pick(params.meeting);
    const meetingDate =
      requestedMeeting && isSaturday(requestedMeeting) ? requestedMeeting : defaultMeetingDate(weekEnd);
    const requestedMeasure = pick(params.measure);
    const measure: WeeklyMeasure = WEEKLY_MEASURES.includes(requestedMeasure as WeeklyMeasure)
      ? (requestedMeasure as WeeklyMeasure)
      : "revenue";

    const data = await buildWeeklyRatings({ entity, measure, weekEnd });

    // Whoever may commit: a role that carries the permission, or a team lead
    // signed in to their own vertical's slice.
    const canCommit =
      !!user && (user.permissions.includes("weekly.commit") || entity.verticalIds !== null);
    const isAdmin = !!user && user.permissions.includes("users.manage");
    const week = weeks.find((w) => w.end === weekEnd)!;

    const tab = (m: WeeklyMeasure) =>
      `/weekly-ratings?measure=${m}&week=${weekEnd}&meeting=${meetingDate}`;

    return (
      <>
        <PageHeader
          title="Weekly ratings"
          subtitle={`${entity.name} · ${week.label} · meeting of ${dateLabel(meetingDate)}`}
        />

        <div className="space-y-4">
          <Card>
            <WeeklyControls
              weeks={weeks}
              weekEnd={weekEnd}
              meetingDate={meetingDate}
              measure={measure}
            />
          </Card>

          <div className="flex flex-wrap gap-2">
            {WEEKLY_MEASURES.map((m) => (
              <Link
                key={m}
                href={tab(m)}
                className={clsx(
                  "rounded-md border px-3 py-1.5 text-[12.5px] font-medium transition-colors",
                  m === measure
                    ? "border-navy bg-navy text-ink-invert"
                    : "border-line text-ink-muted hover:border-line-strong hover:text-ink",
                )}
              >
                {WEEKLY_MEASURE_LABEL[m]}
              </Link>
            ))}
          </div>

          {data.rows.length === 0 ? (
            <EmptyState title="Nothing to rate this week">
              No vertical in this view carries a weekly budget, a commitment or activity for the week
              ended {dateLabel(weekEnd)}.
            </EmptyState>
          ) : (
            <Card padded={false}>
              <div className="px-4 pt-4 sm:px-5">
                <CardTitle hint={`${dateLabel(data.weekStart)} - ${dateLabel(data.weekEnd)}`}>
                  {WEEKLY_MEASURE_LABEL[measure]} — week ended {dateLabel(weekEnd)}
                </CardTitle>
              </div>
              <WeeklyRatingsTable
                rows={data.rows}
                measure={measure}
                weekEnd={weekEnd}
                meetingDate={meetingDate}
                canCommit={canCommit}
                isAdmin={isAdmin}
                quarterLabel={data.quarterLabel}
              />
            </Card>
          )}

          <Notice tone="info" title="How to read this">
            <ul className="ml-4 list-disc space-y-1">
              <li>
                A week runs Sunday to Saturday and is named by the Saturday it ends on. Before it
                begins, the vertical head commits an amount against each customer; the total is the
                figure the week is rated against. Open a row to key or read it.
              </li>
              <li>
                The commitment freezes at the end of the day it is first keyed. An admin can reopen
                one for a day. &ldquo;Achieved?&rdquo; and the remarks are said afterwards, so they
                stay open.
              </li>
              <li>
                Weekly budget is the revised quarterly budget (30 Sep 2026), a third of it for each
                month, spread over the days of the month; collection is 108% of it. Receivables has
                no budget - the commitment is the target.
              </li>
              <li>
                {measure === "revenue"
                  ? "Actual revenue is the ledger's Revenue from Operations for the vertical in the week, the same figure the Revenue tab's Actual is made of. Under each customer, what they were billed."
                  : measure === "collection"
                    ? "Actual collection is fee receipts allocated to the vertical in the week. Under each customer, what they paid."
                    : "Recovered is what the customers named in the commitment actually paid in the week, against the overdue the head committed to recover."}
              </li>
              <li>
                The weekly rating is 0-4 on the Scorecard&rsquo;s bands for actual against what was
                committed: 4 at 100% or more, 3 above 80%, 2 above 60%, 1 above 40%, otherwise 0.
                The scorecard figure is the vertical&rsquo;s composite for the quarter the week
                falls in.
              </li>
            </ul>
          </Notice>
        </div>
      </>
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not reach the database.";
    return <SetupRequired message={message} />;
  }
}

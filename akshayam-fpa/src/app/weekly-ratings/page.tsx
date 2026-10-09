import Link from "next/link";
import clsx from "clsx";
import { SetupRequired } from "@/components/SetupRequired";
import { WeeklyControls } from "@/components/WeeklyControls";
import { WeeklyReceivables } from "@/components/WeeklyReceivables";
import { WeeklyRatingsTable } from "@/components/WeeklyRatingsTable";
import { Card, CardTitle, EmptyState, Notice, PageHeader } from "@/components/ui";
import { getEntity } from "@/lib/entity";
import { dateLabel } from "@/lib/format";
import { getCurrentUser, requireEntityAccess, requireReportAccess } from "@/lib/auth/dal";
import { buildWeeklyRatings } from "@/lib/reports/weekly-ratings";
import { buildWeeklyReceivables } from "@/lib/reports/weekly-receivables";
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
 * MAK meeting (weekly ratings) - the Saturday meeting's commitments and how they landed.
 *
 * Each vertical head commits, before the week begins, what they will bring in:
 * revenue or collection, customer by customer - a collection out of the
 * customers who owe, with their receivables on the same screen. The
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
  await requireReportAccess("weekly");
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

    // Receivables is a tab of its own, not a measure a commitment is rated on.
    const isReceivables = requestedMeasure === "receivables";
    const data = isReceivables ? null : await buildWeeklyRatings({ entity, measure, weekEnd });
    const receivables = isReceivables ? await buildWeeklyReceivables({ entity, weekEnd }) : null;

    // Whoever may commit: a role that carries the permission, or a team lead
    // signed in to their own vertical's slice.
    const canCommit =
      !!user && (user.permissions.includes("weekly.commit") || entity.verticalIds !== null);
    const isAdmin = !!user && user.permissions.includes("users.manage");
    const week = weeks.find((w) => w.end === weekEnd)!;

    const tab = (m: string) =>
      `/weekly-ratings?measure=${m}&week=${weekEnd}&meeting=${meetingDate}`;
    const tabs: { key: string; label: string }[] = [
      ...WEEKLY_MEASURES.map((m) => ({ key: m, label: WEEKLY_MEASURE_LABEL[m] })),
      { key: "receivables", label: "Receivables" },
    ];
    const activeTab = isReceivables ? "receivables" : measure;

    return (
      <>
        <PageHeader
          title="MAK meeting"
          subtitle={`${entity.name} · ${week.label} · meeting of ${dateLabel(meetingDate)}`}
        />

        <div className="space-y-4">
          <Card>
            <WeeklyControls
              weeks={weeks}
              weekEnd={weekEnd}
              meetingDate={meetingDate}
              measure={isReceivables ? "receivables" : measure}
            />
          </Card>

          <div className="flex flex-wrap gap-2">
            {tabs.map((t) => (
              <Link
                key={t.key}
                href={tab(t.key)}
                className={clsx(
                  "rounded-md border px-3 py-1.5 text-[12.5px] font-medium transition-colors",
                  t.key === activeTab
                    ? "border-navy bg-navy text-ink-invert"
                    : "border-line text-ink-muted hover:border-line-strong hover:text-ink",
                )}
              >
                {t.label}
              </Link>
            ))}
          </div>

          {receivables ? (
            <Card padded={false}>
              <div className="px-4 pt-4 sm:px-5">
                <CardTitle hint={`as at ${receivables.arAsOf ? dateLabel(receivables.arAsOf) : "—"}`}>
                  Receivables — week ended {dateLabel(weekEnd)}
                </CardTitle>
              </div>
              <WeeklyReceivables data={receivables} canCommit={canCommit} />
            </Card>
          ) : data && data.rows.length === 0 ? (
            <EmptyState title="Nothing to rate this week">
              No vertical in this view carries a weekly budget, a commitment or activity for the week
              ended {dateLabel(weekEnd)}.
            </EmptyState>
          ) : data ? (
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
                arAsOf={data.arAsOf}
              />
            </Card>
          ) : null}

          {receivables ? (
            <Notice tone="info" title="How to read this">
              <ul className="ml-4 list-disc space-y-1">
                <li>
                  Receivables are read from the latest receivables snapshot on or before the week&rsquo;s
                  end. A receivable is over 180 days when it is more than 180 days past its due date at
                  the snapshot.
                </li>
                <li>
                  For each customer over 180 days, write what is committed for the week; it can be edited
                  until the end of the day it is first keyed. In the weeks that follow, the same row shows
                  last week&rsquo;s commitment, for the review and follow-up and whether it was achieved.
                </li>
                <li>
                  The top 10 customers are the ten who owe the vertical the most, with their share of the
                  vertical&rsquo;s receivables and of the whole entity&rsquo;s.
                </li>
                <li>
                  TDS per Zoho is the TDS receivable booked on each invoice raised this financial year. Form
                  26AS records tax deducted by customer and quarter, not by invoice, so it is compared with
                  the customer&rsquo;s total over the same stretch: the difference, and whether 26AS reflects
                  the TDS (Yes when it covers it, Partly when it shows some, No when it shows none). The
                  follow-up action is yours to write.
                </li>
              </ul>
            </Notice>
          ) : (
          <Notice tone="info" title="How to read this">
            <ul className="ml-4 list-disc space-y-1">
              <li>
                A week runs Sunday to Saturday and is named by the Saturday it ends on. Before it
                begins, the vertical head commits an amount against each customer; the total is the
                figure the week is rated against. Open a row to key or read it.
              </li>
              <li>
                A commitment can be edited until the end of the day it is first keyed, and freezes
                then. An admin can reopen one for a day. &ldquo;Achieved?&rdquo; and the remarks are said afterwards, so they
                stay open.
              </li>
              <li>
                Weekly budget is the revised quarterly budget (30 Sep 2026), a third of it for each
                month, spread over the days of the month; collection is 108% of it.
              </li>
              <li>
                {measure === "revenue"
                  ? "Actual revenue is the ledger's Revenue from Operations for the vertical in the week, the same figure the Revenue tab's Actual is made of. Under each customer, what they were billed."
                  : "Actual collection is fee receipts allocated to the vertical in the week. A collection is committed out of what customers owe: the picker lists the customers on the receivables snapshot with what each owes, and the Receivable outstanding column is the vertical's total. Under each customer, what they paid."}
              </li>
              <li>
                Both weekly ratings are 0-4 on the Vertical Performance Scorecard&rsquo;s bands,
                measured against the weekly budget: 4 at 100% or more, 3 above 80%, 2 above 60%, 1
                above 40%, otherwise 0. <strong>Based on commitments</strong> rates what the head
                undertook to achieve (the committed amount &divide; the weekly budget), so it is
                there from the moment the commitment is keyed. <strong>Based on actuals</strong>{" "}
                rates what was achieved (the actual &divide; the weekly budget), and is there every
                week, committed or not.
              </li>
              <li>
                <strong>% of commitment achieved</strong> is the actual &divide; the committed amount.
              </li>
            </ul>
          </Notice>
          )}
        </div>
      </>
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not reach the database.";
    return <SetupRequired message={message} />;
  }
}

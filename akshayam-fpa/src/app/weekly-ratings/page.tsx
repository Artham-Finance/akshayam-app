import Link from "next/link";
import clsx from "clsx";
import { SetupRequired } from "@/components/SetupRequired";
import { WeeklyControls } from "@/components/WeeklyControls";
import { WeeklyReceivables } from "@/components/WeeklyReceivables";
import { WeeklyRatingsTable } from "@/components/WeeklyRatingsTable";
import { TdsReceivablesTable } from "@/components/TdsReceivablesTable";
import { CmrgaReceivablesTable } from "@/components/CmrgaReceivablesTable";
import { Card, CardTitle, EmptyState, Notice, PageHeader } from "@/components/ui";
import { getEntity } from "@/lib/entity";
import { dateLabel } from "@/lib/format";
import { getCurrentUser, requireEntityAccess, requireReportAccess } from "@/lib/auth/dal";
import { buildWeeklyRatings } from "@/lib/reports/weekly-ratings";
import { buildWeeklyReceivables } from "@/lib/reports/weekly-receivables";
import { buildTdsReceivables } from "@/lib/reports/tds-receivables";
import { buildCmrgaReceivables } from "@/lib/reports/cmrga-receivables";
import {
  WEEKLY_MEASURES,
  WEEKLY_MEASURE_LABEL,
  defaultMeetingDate,
  defaultWeekEnd,
  isValidDate,
  meetingWeeks,
  todayIst,
  type WeeklyMeasure,
} from "@/lib/weekly";

export const dynamic = "force-dynamic";

/**
 * MAK meeting (weekly ratings) - the meeting's commitments and how they landed. The meeting is normally on the Saturday before the week, but its date is free.
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
      requestedMeeting && isValidDate(requestedMeeting) ? requestedMeeting : defaultMeetingDate(weekEnd);
    const requestedMeasure = pick(params.measure);
    const measure: WeeklyMeasure = WEEKLY_MEASURES.includes(requestedMeasure as WeeklyMeasure)
      ? (requestedMeasure as WeeklyMeasure)
      : "revenue";

    // Receivables, CMRGA receivables and TDS receivables are tabs of their own, not measures a commitment is rated on.
    const isReceivables = requestedMeasure === "receivables";
    const isTds = requestedMeasure === "tds";
    const isCmrga = requestedMeasure === "cmrga";
    const data =
      isReceivables || isTds || isCmrga ? null : await buildWeeklyRatings({ entity, measure, weekEnd });
    const receivables = isReceivables ? await buildWeeklyReceivables({ entity, weekEnd }) : null;
    const tdsReceivables = isTds ? await buildTdsReceivables({ entity, weekEnd }) : null;
    // CMRGA's receivables, shifted to other verticals: each vertical sees only what was shifted
    // to it, so the tab is there only for a view that has some.
    const cmrga = await buildCmrgaReceivables({ entity, weekEnd });
    const cmrgaTab = isCmrga || cmrga.verticals.length > 0;

    // Whoever may commit: a role that carries the permission, or a team lead
    // signed in to their own vertical's slice.
    const canCommit =
      !!user && (user.permissions.includes("weekly.commit") || entity.verticalIds !== null);
    const isAdmin = !!user && user.permissions.includes("users.manage");
    // An admin can always edit: nothing is frozen to them, whatever day it was keyed.
    if (isAdmin) {
      data?.rows.forEach((r) => {
        r.locked = false;
      });
      receivables?.verticals.forEach((v) =>
        [...v.over90, ...v.over180].forEach((c) => {
          c.locked = false;
        }),
      );
    }
    const week = weeks.find((w) => w.end === weekEnd)!;

    const tab = (m: string) =>
      `/weekly-ratings?measure=${m}&week=${weekEnd}&meeting=${meetingDate}`;
    const tabs: { key: string; label: string }[] = [
      ...WEEKLY_MEASURES.map((m) => ({ key: m, label: WEEKLY_MEASURE_LABEL[m] })),
      { key: "receivables", label: "Receivables" },
      ...(cmrgaTab ? [{ key: "cmrga", label: "CMRGA receivables" }] : []),
      { key: "tds", label: "TDS receivables" },
    ];
    const activeTab = isReceivables ? "receivables" : isCmrga ? "cmrga" : isTds ? "tds" : measure;

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
              measure={isReceivables ? "receivables" : isCmrga ? "cmrga" : isTds ? "tds" : measure}
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

          {isCmrga ? (
            cmrga.verticals.length === 0 ? (
              <EmptyState title="No CMRGA receivables for this view">
                No receivable of Capital Markets Readiness &amp; Governance Assurance has been shifted to the
                verticals in this view.
              </EmptyState>
            ) : (
              <Card padded={false}>
                <div className="px-4 pt-4 sm:px-5">
                  <CardTitle hint={`shifted as at ${cmrga.asOf ? dateLabel(cmrga.asOf) : "—"}`}>
                    CMRGA receivables — shifted to other verticals
                  </CardTitle>
                </div>
                <CmrgaReceivablesTable data={cmrga} />
              </Card>
            )
          ) : tdsReceivables ? (
            <Card padded={false}>
              <div className="px-4 pt-4 sm:px-5">
                <CardTitle hint="position at 31 Mar 2026">TDS receivables — year wise</CardTitle>
              </div>
              <TdsReceivablesTable data={tdsReceivables} canCommit={canCommit} />
            </Card>
          ) : receivables ? (
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

          {isCmrga ? (
            <Notice tone="info" title="How to read this">
              <ul className="ml-4 list-disc space-y-1">
                <li>
                  Capital Markets Readiness &amp; Governance Assurance (CMRGA) no longer continues, and its open
                  receivables have been shifted to other verticals, invoice by invoice, as at{" "}
                  {cmrga.asOf ? dateLabel(cmrga.asOf) : "the list date"}. A vertical sees only the invoices
                  shifted to it.
                </li>
                <li>
                  What is collected on these invoices after that date is the collection of the vertical they
                  were shifted to: its actual collection is its own plus what it collects from CMRGA&rsquo;s
                  receivables. The amount collected and the date of collection are read from the receipts, up
                  to the week&rsquo;s end.
                </li>
              </ul>
            </Notice>
          ) : tdsReceivables ? (
            <Notice tone="info" title="How to read this">
              <ul className="ml-4 list-disc space-y-1">
                <li>
                  The TDS each customer has deducted that we hold as receivable, as at 31 March 2026,
                  arranged by financial year. The year, vertical, customer and TDS amount are as per the
                  books and cannot be changed here. A vertical sees only its own customers.
                </li>
                <li>
                  Against each, key the invoice it relates to &mdash; number, date and value, as free text.
                  The TDS at 10% of the invoice value fills in as the value is keyed.
                </li>
                <li>
                  The observation and the follow-up action are free text and stay open to edit; press Save on
                  the row to keep what you have keyed.
                </li>
                <li>
                  Below the years, the current financial year is listed invoice by invoice, a quarter at a
                  time: the TDS Zoho books on each invoice, and the amount found in Form 26AS, as the TDS
                  reconciliation on the Receivables page has it. Form 26AS has no invoice numbers, so its
                  amount is the customer&rsquo;s for the quarter, shown once beside that customer&rsquo;s
                  invoices, with the difference (TDS minus Form 26AS) on the customer&rsquo;s total. A quarter
                  whose Form 26AS has not been uploaded shows nil found.
                </li>
              </ul>
            </Notice>
          ) : receivables ? (
            <Notice tone="info" title="How to read this">
              <ul className="ml-4 list-disc space-y-1">
                <li>
                  Receivables are read from the latest receivables snapshot on or before the week&rsquo;s
                  end. A receivable is over 180 days when it is more than 180 days past its due date at
                  the snapshot.
                </li>
                <li>
                  For each customer over 90 or 180 days, write what is committed for the week; it can be
                  edited until the end of the day it is first keyed. In the weeks that follow, the same row
                  lists every earlier week&rsquo;s commitment, each with the week it was made, so the whole
                  history of the receivable is in one place; the review and follow-up is written on the
                  latest of them.
                </li>
                <li>
                  The top 10 customers are the ten who owe the vertical the most, with their share of the
                  vertical&rsquo;s receivables and of the whole entity&rsquo;s.
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
                then. An admin can reopen one for a day. The remarks are said afterwards, so they
                stay open.
              </li>
              <li>
                Weekly budget is the revised quarterly budget (30 Sep 2026), a third of it for each
                month, spread over the days of the month; collection is 108% of it.
              </li>
              <li>
                {measure === "revenue"
                  ? "Actual revenue is the ledger's Revenue from Operations for the vertical in the week, the same figure the Revenue tab's Actual is made of. Open a row to see it broken up by customer and entry; under each committed customer, what they were billed."
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

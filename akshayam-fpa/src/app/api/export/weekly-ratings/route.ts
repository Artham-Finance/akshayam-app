import { NextResponse } from "next/server";
import { getEntity } from "@/lib/entity";
import { dateLabel } from "@/lib/format";
import { buildWeeklyRatings, type WeeklyRow } from "@/lib/reports/weekly-ratings";
import { addSheet, createWorkbook, exportFilename, type SheetColumn } from "@/lib/reports/xlsx";
import { apiGuard } from "@/lib/auth/dal";
import {
  WEEKLY_MEASURE_LABEL,
  defaultMeetingDate,
  defaultWeekEnd,
  isSaturday,
  isValidDate,
  todayIst,
  type WeeklyMeasure,
} from "@/lib/weekly";

export const runtime = "nodejs";

/**
 * The MAK meeting's revenue and collection for one week, for the management review.
 *
 * One summary sheet per measure - a row per vertical, as the screen shows it: the weekly budget,
 * what was committed, the rating on the commitment, the actual, the share of the commitment
 * achieved, the rating on the actual, and the remarks said afterwards - and the customer-wise
 * commitments behind each. Revenue also carries the ledger entries its actual is made of.
 */

const OUTCOME: Record<string, string> = { yes: "Achieved", partly: "Partly achieved", no: "Not achieved" };

const percent = (fraction: number | null) => (fraction === null ? null : fraction * 100);

function summaryColumns(measure: WeeklyMeasure): SheetColumn[] {
  const actual = measure === "revenue" ? "Actual revenue (GL)" : "Actual collection";
  const committed = measure === "revenue" ? "Revenue committed" : "Collection committed";
  return [
    { header: "Vertical", type: "text", strong: true },
    { header: "Weekly budget", type: "money" },
    ...(measure === "collection"
      ? ([
          { header: "Receivable outstanding", type: "money" },
          { header: "Of which overdue", type: "money" },
        ] as SheetColumn[])
      : []),
    { header: committed, type: "money" },
    { header: "Weekly rating based on commitments", type: "int" },
    { header: actual, type: "money", strong: true },
    { header: "% of commitment achieved", type: "percent" },
    { header: "Weekly rating based on actuals", type: "int" },
    { header: "Outcome", type: "text" },
    { header: "Remarks", type: "text" },
  ];
}

function summaryRow(measure: WeeklyMeasure, r: WeeklyRow): (string | number | null)[] {
  return [
    r.label,
    r.budget,
    ...(measure === "collection" ? [r.receivableTotal, r.receivableOverdue] : []),
    r.hasCommitment ? r.committed : null,
    r.commitmentRating,
    r.actual,
    percent(r.pctOfCommitment),
    r.actualRating,
    r.achieved ? OUTCOME[r.achieved] : null,
    r.remarks,
  ];
}

export async function GET(request: Request) {
  const { user, denied } = await apiGuard("reports.export");
  if (denied) return denied;
  // The MAK meeting is a per-person grant like the other report pages.
  if (!user.reportAccess.includes("weekly")) {
    return NextResponse.json({ error: "You have not been given access to the MAK meeting." }, { status: 403 });
  }

  const url = new URL(request.url);
  const weekParam = url.searchParams.get("week");
  const weekEnd =
    weekParam && isValidDate(weekParam) && isSaturday(weekParam) ? weekParam : defaultWeekEnd(todayIst());
  const meetingParam = url.searchParams.get("meeting");
  const meetingDate = meetingParam && isValidDate(meetingParam) ? meetingParam : defaultMeetingDate(weekEnd);
  const verticalParam = Number(url.searchParams.get("vertical"));
  const verticalId = Number.isFinite(verticalParam) && verticalParam > 0 ? verticalParam : null;

  try {
    const entity = await getEntity();
    const [revenue, collection] = await Promise.all([
      buildWeeklyRatings({ entity, measure: "revenue", weekEnd, verticalId }),
      buildWeeklyRatings({ entity, measure: "collection", weekEnd, verticalId }),
    ]);

    const context = (measure: WeeklyMeasure, extra: string[] = []) => [
      entity.name,
      `Week ended ${dateLabel(weekEnd)} (${dateLabel(revenue.weekStart)} - ${dateLabel(weekEnd)})`,
      `Meeting of ${dateLabel(meetingDate)}`,
      ...(verticalId !== null && revenue.rows.length === 1 ? [revenue.rows[0].label] : []),
      ...extra,
      WEEKLY_MEASURE_LABEL[measure],
    ];

    const workbook = createWorkbook();

    for (const [measure, data] of [
      ["revenue", revenue],
      ["collection", collection],
    ] as const) {
      const label = WEEKLY_MEASURE_LABEL[measure];
      addSheet(workbook, {
        name: label,
        title: `MAK meeting — ${label}, week ended ${dateLabel(weekEnd)}`,
        context: context(measure, [
          ...(measure === "collection" && data.arAsOf ? [`Receivables as at ${dateLabel(data.arAsOf)}`] : []),
        ]),
        columns: summaryColumns(measure),
        rows: data.rows.map((r) => summaryRow(measure, r)),
        totals: true,
        freezeColumns: 1,
      });
    }

    // The customer-wise commitments behind each summary.
    addSheet(workbook, {
      name: "Revenue - customers",
      title: `Revenue committed, customer by customer — week ended ${dateLabel(weekEnd)}`,
      context: context("revenue"),
      columns: [
        { header: "Vertical", type: "text" },
        { header: "Customer", type: "text", strong: true },
        { header: "Committed", type: "money" },
        { header: "Billed in the week", type: "money", strong: true },
      ],
      rows: revenue.rows.flatMap((r) => r.lines.map((l) => [r.label, l.customer, l.amount, l.actual])),
      totals: true,
    });
    addSheet(workbook, {
      name: "Collection - customers",
      title: `Collection committed, customer by customer — week ended ${dateLabel(weekEnd)}`,
      context: context("collection"),
      columns: [
        { header: "Vertical", type: "text" },
        { header: "Customer", type: "text", strong: true },
        { header: "Committed", type: "money" },
        { header: "Received in the week", type: "money", strong: true },
        { header: "Receivable outstanding", type: "money" },
      ],
      rows: collection.rows.flatMap((r) =>
        r.lines.map((l) => [r.label, l.customer, l.amount, l.actual, l.outstanding]),
      ),
      totals: true,
    });

    // What the revenue actual is made of, entry by entry.
    addSheet(workbook, {
      name: "Revenue - entries",
      title: `Actual revenue, entry by entry — week ended ${dateLabel(weekEnd)}`,
      context: context("revenue"),
      columns: [
        { header: "Vertical", type: "text" },
        { header: "Customer", type: "text", strong: true },
        { header: "Date", type: "date" },
        { header: "Source", type: "text" },
        { header: "Reference", type: "text" },
        { header: "Amount", type: "money", strong: true },
      ],
      rows: revenue.rows.flatMap((r) =>
        r.breakup.map((e) => [r.label, e.customer, e.date, e.source, e.ref, e.amount]),
      ),
      totals: true,
    });

    const buffer = await workbook.xlsx.writeBuffer();
    return new NextResponse(buffer as ArrayBuffer, {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${exportFilename(entity.name, `MAK meeting - week ended ${dateLabel(weekEnd)}`)}"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not build the spreadsheet.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

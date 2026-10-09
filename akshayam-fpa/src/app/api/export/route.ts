import { NextResponse } from "next/server";
import { getAvailableFinancialYears, getEntity, getVerticals } from "@/lib/entity";
import { apiGuard } from "@/lib/auth/dal";
import { query } from "@/lib/db";
import { fyLabel } from "@/lib/period";
import { buildScorecard, resolveScorecardScope } from "@/lib/reports/scorecard";
import { buildScorecardWorkbook } from "@/lib/reports/scorecard-export";
import { buildApportionmentWorkbook } from "@/lib/reports/apportionment-export";
import { costApportionmentKeyFor } from "@/lib/reports/vertical-cost-apportionment";
import { fyMonths } from "@/lib/period";
import {
  getReportingPeriod,
  ledgerWrittenTo,
} from "@/lib/reporting-period";
import { isDrill, runDrill, type DrillKind } from "@/lib/reports/drilldowns";
import {
  buildStatementWorkbook,
  isStatementKind,
  statementTitle,
} from "@/lib/reports/statement-export";
import { addSheet, createWorkbook, exportFilename } from "@/lib/reports/xlsx";

export const runtime = "nodejs";

/**
 * Anything on screen, as a spreadsheet.
 *
 * Two shapes go through here. A drill-down is a list of documents, and its
 * export is the same query the screen ran with the row cap lifted - the point
 * of a download is to get the lot. A statement is a grid of periods, and its
 * export carries every month *and* every quarter, because a sheet cannot
 * expand a column on click and hiding one is easier than rebuilding it.
 *
 * Both come from the same builders the pages use. They were briefly separate,
 * and that is exactly how a downloaded file comes to disagree with the screen
 * it was downloaded from.
 */
const DRILL_KINDS: DrillKind[] = ["collections", "receivables", "revenue"];

export async function GET(request: Request) {
  const { user, denied } = await apiGuard("reports.export");
  if (denied) return denied;

  const url = new URL(request.url);
  const kind = String(url.searchParams.get("kind") ?? "");
  const drill = url.searchParams.get("drill");
  // A customer-filtered panel must export the customer it is showing, not the
  // whole book under the same heading.
  const customer = url.searchParams.get("customer") || null;
  // Likewise a panel opened from one currency: the download is the panel.
  const currency = url.searchParams.get("currency") || null;

  try {
    const entity = await getEntity();

    // The reporting period comes from the same cookie the pages read, so a
    // download always matches the screen it came from.
    const availableYears = await getAvailableFinancialYears(entity.memberIds);
    const preview = await getReportingPeriod(entity, availableYears);
    const writtenTo = await ledgerWrittenTo(entity.memberIds, preview.fyStartYear);
    const period = await getReportingPeriod(entity, availableYears, writtenTo);
    const fy = period.fyStartYear;
    const start = period.start;
    const end = period.end;

    const requestedVertical = Number(url.searchParams.get("vertical"));
    const verticalId =
      Number.isFinite(requestedVertical) && requestedVertical > 0 ? requestedVertical : null;

    /* ---------- the Vertical Performance Scorecard ---------- */

    if (kind === "scorecard") {
      // The same per-person grant that opens the page.
      if (!user.reportAccess.includes("scorecard")) {
        return NextResponse.json({ error: "You have not been given access to the Scorecard." }, { status: 403 });
      }
      // A team lead's slice is struck across the company it is cut from, and
      // sees just their own rows - exactly as on screen.
      const { isSlice, benchmark, visibleCodes } = await resolveScorecardScope(entity);
      const years = await getAvailableFinancialYears(benchmark.memberIds);
      const requestedFy = Number(url.searchParams.get("fy"));
      const scFy = years.includes(requestedFy) ? requestedFy : (years[0] ?? fy);
      const scMonths = fyMonths(scFy, benchmark.fy_start_month);
      const reached = ledgerWrittenTo ? await ledgerWrittenTo(benchmark.memberIds, scFy) : null;
      const reachedMonths = scMonths.filter((m) => m.start <= (reached ?? scMonths[11].end));
      const latestQuarter = reachedMonths.at(-1)?.quarter ?? 1;
      const requestedQ = Number(url.searchParams.get("q"));
      const quarter = ([1, 2, 3, 4].includes(requestedQ) ? requestedQ : latestQuarter) as 1 | 2 | 3 | 4;
      const cumulative = url.searchParams.get("basis") !== "quarter";
      const requestedMonth = url.searchParams.get("m");
      const scMonth =
        scMonths.find((m) => m.key === requestedMonth && m.quarter === quarter)?.key ?? null;

      const data = await buildScorecard({
        entity: benchmark,
        fyStartYear: scFy,
        quarter,
        cumulative,
        month: scMonth,
      });
      const shown = isSlice && visibleCodes ? data.rows.filter((r) => visibleCodes.has(r.code)) : data.rows;
      const slugs = (
        await query<{ slug: string }>("select slug from entities where id = any($1::int[])", [
          benchmark.memberIds,
        ])
      ).map((r) => r.slug);

      const workbook = buildScorecardWorkbook({
        entityName: benchmark.name,
        fyLabel: fyLabel(scFy),
        data,
        shown,
        isPartial: isSlice,
        fyStartYear: scFy,
        companySlugs: slugs,
        cumulativeNote: !scMonth && cumulative && quarter > 1 ? " (cumulative)" : "",
      });
      const buffer = await workbook.xlsx.writeBuffer();
      return spreadsheet(buffer, exportFilename(benchmark.name, "Vertical Performance Scorecard workings"));
    }

    /* ---------- the vertical-wise P&L after cost apportionment ---------- */

    if (kind === "pnl-apportionment") {
      // The card is the P&L's; the same per-person grant opens it.
      if (!user.reportAccess.includes("pnl")) {
        return NextResponse.json({ error: "You have not been given access to the P&L." }, { status: 403 });
      }
      // A team lead's slice sees only its own vertical(s), as on screen - the spread
      // is still struck across all six, then narrowed.
      const mine = entity.verticalIds
        ? new Set(
            (await getVerticals(entity))
              .map((v) => costApportionmentKeyFor(v.code))
              .filter((k): k is string => k !== null),
          )
        : null;
      // A head whose vertical is outside the six (AIF, GIFT, Common...) has no share.
      const workbook =
        mine && mine.size === 0
          ? null
          : await buildApportionmentWorkbook({
              entity,
              fyStartYear: fy,
              through: end,
              only: mine,
            });
      if (!workbook) {
        return NextResponse.json(
          { error: "There is nothing to apportion for this view - the card applies to RBJV's six verticals." },
          { status: 404 },
        );
      }
      const buffer = await workbook.xlsx.writeBuffer();
      return spreadsheet(buffer, exportFilename(entity.name, "Vertical P&L after cost apportionment"));
    }

    /* ---------- statements ---------- */

    if (isStatementKind(kind)) {
      const verticalName = verticalId
        ? ((await getVerticals(entity)).find((v) => v.id === verticalId)?.name ?? null)
        : null;

      // Year to date, always - the same window the Other-expenses breakdown
      // shows beside whatever the picker's own period is.
      const ytdMonths = fyMonths(fy, entity.fy_start_month).filter(
        (m) => m.start <= (writtenTo ?? end),
      );

      const workbook = await buildStatementWorkbook({
        kind,
        entity,
        fyStartYear: fy,
        verticalId,
        verticalName,
        window: { start, end },
        asOf: period.asOf,
        periodMonths: period.periodMonths,
        periodLabel: period.label,
        ytdMonths,
      });
      const buffer = await workbook.xlsx.writeBuffer();
      return spreadsheet(buffer, exportFilename(entity.name, statementTitle(kind)));
    }

    /* ---------- drill-downs ---------- */

    if (!DRILL_KINDS.includes(kind as DrillKind)) {
      return NextResponse.json({ error: "Unknown report." }, { status: 400 });
    }
    if (!isDrill(kind as DrillKind, drill)) {
      return NextResponse.json({ error: "Unknown drill-down." }, { status: 400 });
    }

    const result = await runDrill({
      kind: kind as DrillKind,
      drill,
      entity,
      start,
      end,
      verticalId,
      customer,
      currency,
    });
    if (!result) return NextResponse.json({ error: "Nothing to export." }, { status: 404 });

    const context = [entity.name];
    if (kind !== "receivables") context.push(period.label);
    if (verticalId) context.push("filtered to one vertical");
    if (customer) context.push(customer);
    if (currency) context.push(`raised in ${currency.toUpperCase()}`);
    context.push(`${result.total} row${result.total === 1 ? "" : "s"}`);

    const workbook = createWorkbook();
    addSheet(workbook, {
      name: result.title,
      title: result.title,
      context,
      /*
        The sheet has no currency-aware money format, and does not need one:
        the code sits in its own column beside the figure. So a currency cell
        writes as text and an own-currency amount as an ordinary number, which
        is what lets the recipient sort and total it.
      */
      columns: result.columns.map((c) => ({
        header: c.header,
        type: c.type === "currency" ? "text" : c.type === "money_ccy" ? "money" : c.type,
        strong: c.strong,
      })),
      rows: result.rows,
      totals: true,
    });

    const buffer = await workbook.xlsx.writeBuffer();
    return spreadsheet(buffer, exportFilename(entity.name, result.title));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not build the spreadsheet.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function spreadsheet(buffer: ArrayBuffer | Buffer, filename: string) {
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}

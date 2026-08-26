import { NextResponse } from "next/server";
import { getEntity, getVerticals } from "@/lib/entity";
import { apiGuard } from "@/lib/auth/dal";
import { fyBounds, fyLabel, fyStartYearOf } from "@/lib/period";
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
  const { denied } = await apiGuard("reports.export");
  if (denied) return denied;

  const url = new URL(request.url);
  const kind = String(url.searchParams.get("kind") ?? "");
  const drill = url.searchParams.get("drill");

  try {
    const entity = await getEntity();

    const requestedFy = Number(url.searchParams.get("fy"));
    const fy = Number.isFinite(requestedFy) && requestedFy > 2000 ? requestedFy : fyStartYearOf();
    const { start, end } = fyBounds(fy);

    const requestedVertical = Number(url.searchParams.get("vertical"));
    const verticalId =
      Number.isFinite(requestedVertical) && requestedVertical > 0 ? requestedVertical : null;

    /* ---------- statements ---------- */

    if (isStatementKind(kind)) {
      const verticalName = verticalId
        ? ((await getVerticals(entity)).find((v) => v.id === verticalId)?.name ?? null)
        : null;

      const workbook = await buildStatementWorkbook({
        kind,
        entity,
        fyStartYear: fy,
        verticalId,
        verticalName,
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
    });
    if (!result) return NextResponse.json({ error: "Nothing to export." }, { status: 404 });

    const context = [entity.name];
    if (kind !== "receivables") context.push(fyLabel(fy));
    if (verticalId) context.push("filtered to one vertical");
    context.push(`${result.total} row${result.total === 1 ? "" : "s"}`);

    const workbook = createWorkbook();
    addSheet(workbook, {
      name: result.title,
      title: result.title,
      context,
      columns: result.columns.map((c) => ({
        header: c.header,
        type: c.type,
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

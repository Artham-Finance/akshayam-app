import { NextResponse } from "next/server";
import { getEntity } from "@/lib/entity";
import { fyBounds, fyLabel } from "@/lib/period";
import { buildReimbursementReco, type RecoRow } from "@/lib/reports/reimbursement-reco";
import { addSheet, createWorkbook, exportFilename, type SheetColumn } from "@/lib/reports/xlsx";
import { apiGuard } from "@/lib/auth/dal";

export const runtime = "nodejs";

const COLUMNS: SheetColumn[] = [
  { header: "Entity", type: "text" },
  { header: "RI reference", type: "text", strong: true },
  { header: "Bill date", type: "date" },
  { header: "Vendor", type: "text" },
  { header: "Client (RE side)", type: "text" },
  { header: "RE amount", type: "money" },
  { header: "RI date", type: "date" },
  { header: "RI client", type: "text" },
  { header: "RI amount", type: "money" },
];

function rowsOf(lines: RecoRow[]): (string | number | null)[][] {
  return lines.map((r) => [
    r.entityName,
    r.riRef,
    r.reDate,
    r.reVendor,
    r.reCustomer,
    r.reAmount,
    r.riDate,
    r.riCustomer,
    r.riAmount,
  ]);
}

export async function GET(request: Request) {
  const { denied } = await apiGuard("reports.export");
  if (denied) return denied;

  const url = new URL(request.url);
  const fyParam = Number(url.searchParams.get("fy"));

  try {
    const entity = await getEntity();
    const fyStartYear = Number.isFinite(fyParam) && fyParam > 0 ? fyParam : new Date().getFullYear();
    const { start, end } = fyBounds(fyStartYear, entity.fy_start_month);

    const reco = await buildReimbursementReco({ entity, start, end, fyStartYear });
    const context = [entity.name, fyLabel(fyStartYear)];

    const workbook = createWorkbook();
    addSheet(workbook, {
      name: "RI still needs raising",
      title: "RI still needs raising",
      context: [...context, `${reco.totals.reNeedsRiCount} line(s)`],
      columns: COLUMNS,
      rows: rowsOf(reco.reNeedsRi),
      totals: true,
    });
    addSheet(workbook, {
      name: "RI raised, RE not accounted",
      title: "RI raised — RE not accounted",
      context: [...context, `${reco.totals.riOnlyCount} line(s)`],
      columns: COLUMNS,
      rows: rowsOf(reco.riOnly),
      totals: true,
    });
    addSheet(workbook, {
      name: "No RI number on the line",
      title: "No RI number on the bill line",
      context: [...context, `${reco.totals.reNotTaggedCount} line(s)`],
      columns: COLUMNS,
      rows: rowsOf(reco.reNotTagged),
      totals: true,
    });
    addSheet(workbook, {
      name: "Prior-year reference",
      title: "Prior-year reference — can't verify",
      context: [...context, `${reco.totals.rePriorYearCount} line(s)`],
      columns: COLUMNS,
      rows: rowsOf(reco.rePriorYear),
      totals: true,
    });
    addSheet(workbook, {
      name: "Matched",
      title: "RE accounted — RI raised — matched",
      context: [...context, `${reco.totals.matchedCount} line(s)`],
      columns: COLUMNS,
      rows: rowsOf(reco.matched),
      totals: true,
    });

    const buffer = await workbook.xlsx.writeBuffer();
    return new NextResponse(buffer as ArrayBuffer, {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${exportFilename(entity.name, "RE-RI Reconciliation")}"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not build the spreadsheet.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

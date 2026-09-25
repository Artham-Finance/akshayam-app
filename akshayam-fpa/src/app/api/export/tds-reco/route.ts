import { NextResponse } from "next/server";
import { getEntity } from "@/lib/entity";
import { fyLabel, type QuarterNo } from "@/lib/period";
import { buildTdsRecoExport, TDS_SEGMENT_LABEL, type TdsSegment } from "@/lib/reports/tds";
import { addSheet, createWorkbook, exportFilename, type SheetColumn } from "@/lib/reports/xlsx";
import { apiGuard } from "@/lib/auth/dal";

export const runtime = "nodejs";

const SUMMARY_COLUMNS: SheetColumn[] = [
  { header: "Customer", type: "text" },
  { header: "Vertical", type: "text" },
  { header: "Segment", type: "text" },
  { header: "Per books", type: "money" },
  { header: "Per Form 26AS", type: "money" },
  { header: "Difference", type: "money", strong: true },
];

const BOOKS_COLUMNS: SheetColumn[] = [
  { header: "Segment", type: "text" },
  { header: "Customer", type: "text" },
  { header: "Vertical", type: "text" },
  { header: "Invoice", type: "text" },
  { header: "Invoice date", type: "date" },
  { header: "TDS booked", type: "money", strong: true },
];

const FORM26AS_COLUMNS: SheetColumn[] = [
  { header: "Segment", type: "text" },
  { header: "Customer", type: "text" },
  { header: "Deductor", type: "text" },
  { header: "TAN", type: "text" },
  { header: "Section", type: "text" },
  { header: "Transaction date", type: "date" },
  { header: "Amount credited", type: "money" },
  { header: "TDS", type: "money", strong: true },
];

function isQuarter(n: number): n is QuarterNo {
  return n === 1 || n === 2 || n === 3 || n === 4;
}

function isSegment(value: string | null): value is TdsSegment {
  return (
    value === "matched" ||
    value === "difference" ||
    value === "books_only" ||
    value === "ret_only"
  );
}

export async function GET(request: Request) {
  const { denied } = await apiGuard("reports.export");
  if (denied) return denied;

  const url = new URL(request.url);
  const fyParam = Number(url.searchParams.get("fy"));
  const qParam = Number(url.searchParams.get("q"));
  const verticalParam = Number(url.searchParams.get("vertical"));
  const customerParam = url.searchParams.get("customer");
  const segmentParam = url.searchParams.get("segment");
  const segment = isSegment(segmentParam) ? segmentParam : null;

  if (!Number.isFinite(fyParam) || fyParam <= 0 || !isQuarter(qParam)) {
    return NextResponse.json({ error: "A financial year and quarter are required." }, { status: 400 });
  }

  try {
    const entity = await getEntity();
    const verticalId = Number.isFinite(verticalParam) && verticalParam > 0 ? verticalParam : null;
    const customer = customerParam || null;

    const reco = await buildTdsRecoExport(
      { entity, fyStartYear: fyParam, quarter: qParam, verticalId, customer },
      { segment },
    );

    const segmentLabel = (s: TdsSegment) => TDS_SEGMENT_LABEL[s];
    const context = [
      entity.name,
      fyLabel(fyParam),
      reco.quarterLabel,
      ...(segment ? [segmentLabel(segment)] : []),
    ];

    const workbook = createWorkbook();
    addSheet(workbook, {
      name: "Summary",
      title: "TDS reconciliation — by customer",
      context: [...context, `${reco.summary.length} customer(s)`],
      columns: SUMMARY_COLUMNS,
      rows: reco.summary.map((r) => [
        r.label,
        r.verticalCode ?? "—",
        segmentLabel(r.segment),
        r.books,
        r.form26as,
        r.difference,
      ]),
      totals: true,
    });
    addSheet(workbook, {
      name: "Books",
      title: "TDS booked — every invoice",
      context: [...context, `${reco.books.length} invoice(s)`],
      columns: BOOKS_COLUMNS,
      rows: reco.books.map((r) => [
        segmentLabel(r.segment),
        r.customer,
        r.verticalCode ?? "—",
        r.invoiceNumber ?? "—",
        r.invoiceDate,
        r.amount,
      ]),
      totals: true,
    });
    addSheet(workbook, {
      name: "Form 26AS",
      title: "Form 26AS — every entry",
      context: [...context, `${reco.form26as.length} entr${reco.form26as.length === 1 ? "y" : "ies"}`],
      columns: FORM26AS_COLUMNS,
      rows: reco.form26as.map((r) => [
        segmentLabel(r.segment),
        r.customer,
        r.deductorName ?? "—",
        r.tan ?? "—",
        r.section ?? "—",
        r.transactionDate,
        r.amountCredited,
        r.taxDeducted,
      ]),
      totals: true,
    });

    const title = segment
      ? `TDS Reconciliation ${reco.quarterLabel} - ${segmentLabel(segment)}`
      : `TDS Reconciliation ${reco.quarterLabel}`;
    const buffer = await workbook.xlsx.writeBuffer();
    return new NextResponse(buffer as ArrayBuffer, {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${exportFilename(entity.name, title)}"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not build the spreadsheet.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

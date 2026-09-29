import { NextResponse } from "next/server";
import { getEntity } from "@/lib/entity";
import { buildCustomerRevenueTrend } from "@/lib/reports/customer-trend";
import { addSheet, createWorkbook, exportFilename, type SheetColumn } from "@/lib/reports/xlsx";
import { apiGuard } from "@/lib/auth/dal";

export const runtime = "nodejs";

export async function GET() {
  const { denied } = await apiGuard("reports.export");
  if (denied) return denied;

  try {
    const entity = await getEntity();
    const trend = await buildCustomerRevenueTrend(entity);

    const columns: SheetColumn[] = [
      { header: "Customer", type: "text" },
      ...trend.years.map((y) => ({
        header: y.isCurrent ? `${y.label} (YTD)` : y.label,
        type: "money" as const,
      })),
      { header: "Total", type: "money", strong: true },
    ];

    const workbook = createWorkbook();
    addSheet(workbook, {
      name: "Customer trend",
      title: "Customer-wise revenue, year on year",
      context: [
        entity.name,
        "Basis: the ledger where uploaded, Zoho Invoice Details where not, net of RI reimbursement recharges",
        `${trend.rows.length} customer(s)`,
      ],
      columns,
      rows: [
        ["Total", ...trend.years.map((y) => trend.totalByYear[y.fy] ?? 0), trend.grandTotal],
        ...trend.rows.map((r) => [r.customer, ...trend.years.map((y) => r.byYear[y.fy] ?? 0), r.total]),
      ],
      emphasise: [0],
      rule: [1],
      freezeColumns: 1,
    });

    const buffer = await workbook.xlsx.writeBuffer();
    return new NextResponse(buffer as ArrayBuffer, {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${exportFilename(entity.name, "Customer-wise revenue trend")}"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not build the spreadsheet.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

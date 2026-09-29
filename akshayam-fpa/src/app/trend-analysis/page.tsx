import { CustomerTrendTable } from "@/components/CustomerTrendTable";
import { SetupRequired } from "@/components/SetupRequired";
import { Card, CardTitle, DownloadExcel, Notice, PageHeader } from "@/components/ui";
import { getEntity } from "@/lib/entity";
import { buildCustomerRevenueTrend } from "@/lib/reports/customer-trend";
import { requireEntityAccess } from "@/lib/auth/dal";

export const dynamic = "force-dynamic";

/** Rows shown on screen, largest customers first; the Excel download carries every one. */
const SHOWN_ON_SCREEN = 100;

/**
 * Trend Analysis.
 *
 * Customer-wise revenue, year on year - the one place in the app that reads
 * the invoice register directly rather than the ledger-derived figure
 * everything else is struck on, because its whole purpose is years the
 * ledger was never uploaded for at all. See customer-trend.ts for why.
 */
export default async function TrendAnalysisPage() {
  await requireEntityAccess();
  try {
    const entity = await getEntity();
    const trend = await buildCustomerRevenueTrend(entity);

    return (
      <>
        <PageHeader
          title="Trend Analysis"
          subtitle={`${entity.name} · customer-wise revenue, year on year`}
        />

        <div className="space-y-4">
          <Notice tone="info" title="Basis: the ledger where it exists, Zoho Invoice Details where it does not">
            A year the general ledger has been uploaded for reads the same ledger-derived figure
            every other revenue view in the app is struck on. A year the ledger was never
            uploaded for at all falls back to the raw Invoice Details register instead - a
            one-time export, not vetted the way the ledger is, but the only record that exists
            for it. Reimbursement recharges (invoice numbers starting &ldquo;RI-&rdquo;) are left
            out everywhere, the same as Revenue elsewhere; in a register-sourced year, void,
            rejected and draft invoices are left out too. The current year is not yet finished
            and is marked YTD.
          </Notice>

          <Card padded={false}>
            <div className="flex flex-wrap items-center justify-between gap-3 px-3 pt-3">
              <CardTitle hint={`${trend.rows.length} customer(s) across ${trend.years.length} year(s)`}>
                Revenue by customer, by year
              </CardTitle>
              <DownloadExcel href="/api/export/customer-trend" />
            </div>
            <CustomerTrendTable trend={trend} limit={SHOWN_ON_SCREEN} />
          </Card>
        </div>
      </>
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not reach the database.";
    return <SetupRequired message={message} />;
  }
}

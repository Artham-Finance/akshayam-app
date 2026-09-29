import { CustomerTrendTable } from "@/components/CustomerTrendTable";
import { NewCustomersTable } from "@/components/NewCustomersTable";
import { SetupRequired } from "@/components/SetupRequired";
import { Card, CardTitle, DownloadExcel, Notice, PageHeader } from "@/components/ui";
import { getEntity } from "@/lib/entity";
import { compactINR } from "@/lib/format";
import {
  buildCustomerInvoiceDetailBatch,
  buildCustomerRevenueTrend,
} from "@/lib/reports/customer-trend";
import { requireEntityAccess } from "@/lib/auth/dal";

export const dynamic = "force-dynamic";

/** Rows shown on screen, largest customers first; the Excel download carries every one. */
const SHOWN_ON_SCREEN = 100;

/**
 * Trend Analysis.
 *
 * Customer-wise revenue, year on year, and which of this year's customers
 * were not billed in any earlier year on the table. See customer-trend.ts
 * for how a year picks between the ledger and the raw invoice register.
 */
export default async function TrendAnalysisPage() {
  await requireEntityAccess();
  try {
    const entity = await getEntity();
    const trend = await buildCustomerRevenueTrend(entity);

    // Every customer whose row could be expanded on screen - the invoices
    // behind them are fetched once, up front, so the arrow is instant.
    const expandable = new Set<string>();
    for (const r of trend.rows.slice(0, SHOWN_ON_SCREEN)) expandable.add(r.customer);
    for (const r of trend.newCustomers) expandable.add(r.customer);
    const invoicesByCustomerMap = await buildCustomerInvoiceDetailBatch(
      entity,
      [...expandable],
    );
    const invoicesByCustomer = Object.fromEntries(invoicesByCustomerMap);

    const currentYear = trend.years.find((y) => y.isCurrent);
    const currentTotal = currentYear ? (trend.totalByYear[currentYear.fy] ?? 0) : 0;

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
              <CardTitle hint={`${trend.rows.length} customer(s) across ${trend.years.length} year(s) · the arrow opens their invoices`}>
                Revenue by customer, by year
              </CardTitle>
              <DownloadExcel href="/api/export/customer-trend" />
            </div>
            <CustomerTrendTable
              trend={trend}
              limit={SHOWN_ON_SCREEN}
              invoicesByCustomer={invoicesByCustomer}
            />
          </Card>

          <Card padded={false}>
            <div className="px-3 pt-3">
              <CardTitle
                hint={
                  currentYear
                    ? `${trend.newCustomers.length} customer(s) · ${compactINR(trend.newCustomersTotal)}`
                    : undefined
                }
              >
                New customers{currentYear ? ` in ${currentYear.label}` : ""}
              </CardTitle>
              <p className="mb-1 text-[11.5px] text-ink-muted">
                Billed for the first time this year - no revenue in any earlier year on the table
                above. The arrow opens their invoices.
              </p>
            </div>
            <NewCustomersTable
              customers={trend.newCustomers}
              total={trend.newCustomersTotal}
              currentTotal={currentTotal}
              invoicesByCustomer={invoicesByCustomer}
            />
          </Card>
        </div>
      </>
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not reach the database.";
    return <SetupRequired message={message} />;
  }
}

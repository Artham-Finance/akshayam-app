import Link from "next/link";
import clsx from "clsx";
import { CustomerTrendTable } from "@/components/CustomerTrendTable";
import { NewCustomersTable } from "@/components/NewCustomersTable";
import { PerformanceControls } from "@/components/PerformanceControls";
import { PerformanceTable } from "@/components/PerformanceTable";
import { SetupRequired } from "@/components/SetupRequired";
import { Card, CardTitle, CompanyOnly, DownloadExcel, EmptyState, Notice, PageHeader } from "@/components/ui";
import { getEntity, type Entity } from "@/lib/entity";
import { compactINR, dateLabel } from "@/lib/format";
import {
  buildCustomerInvoiceDetailBatch,
  buildCustomerRevenueTrend,
} from "@/lib/reports/customer-trend";
import {
  buildPerformanceTrend,
  parsePeriod,
  periodLabel,
  periodOptions,
  periodValue,
} from "@/lib/reports/performance-trend";
import { requireEntityAccess } from "@/lib/auth/dal";

export const dynamic = "force-dynamic";

/** Rows shown on screen, largest customers first; the Excel download carries every one. */
const SHOWN_ON_SCREEN = 100;

const TABS = [
  { key: "performance", label: "Performance" },
  { key: "revenue", label: "Revenue" },
] as const;

/**
 * Trend Analysis, in two tabs.
 *
 *   Performance - Revenue, Expenses, Profit before tax and Profit after tax for a month, a
 *                 quarter ended, a half year ended or the year, beside the same period of the
 *                 years before (performance-trend.ts).
 *   Revenue     - customer-wise revenue, year on year, and which of this year's customers were
 *                 not billed in any earlier year (customer-trend.ts).
 */
export default async function TrendAnalysisPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireEntityAccess();
  const params = await searchParams;
  const pick = (v: string | string[] | undefined) => (typeof v === "string" ? v : null);
  const tab = pick(params.tab) === "revenue" ? "revenue" : "performance";

  try {
    const entity = await getEntity();
    return (
      <>
        <PageHeader
          title="Trend Analysis"
          subtitle={`${entity.name} · ${tab === "performance" ? "performance, period against the same period of earlier years" : "customer-wise revenue, year on year"}`}
        />
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {TABS.map((t) => (
              <Link
                key={t.key}
                href={`/trend-analysis?tab=${t.key}`}
                className={clsx(
                  "rounded-md border px-3 py-1.5 text-[12.5px] font-medium transition-colors",
                  t.key === tab
                    ? "border-navy bg-navy text-ink-invert"
                    : "border-line text-ink-muted hover:border-line-strong hover:text-ink",
                )}
              >
                {t.label}
              </Link>
            ))}
          </div>

          {tab === "performance" ? (
            <PerformanceTab
              entity={entity}
              fy={pick(params.fy)}
              period={pick(params.period)}
            />
          ) : (
            <RevenueTab entity={entity} />
          )}
        </div>
      </>
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not reach the database.";
    return <SetupRequired message={message} />;
  }
}

async function PerformanceTab({
  entity,
  fy,
  period,
}: {
  entity: Entity;
  fy: string | null;
  period: string | null;
}) {
  if (entity.verticalIds) {
    return <CompanyOnly what="The performance comparison" slice companies={entity.memberIds.length} />;
  }
  if (entity.isGroup) return <CompanyOnly what="The performance comparison" />;

  const requestedFy = fy && /^\d{4}$/.test(fy) ? Number(fy) : null;
  const trend = await buildPerformanceTrend({
    entity,
    fyStartYear: requestedFy,
    period: parsePeriod(period),
  });

  if (trend.financialYears.length === 0) {
    return (
      <EmptyState title="No figures yet" href="/upload" cta="Go to Upload">
        Upload the past years&apos; monthly Profit and Loss, and the General Ledger for the current year,
        and this compares any month, quarter or half year with the same period of the years before.
      </EmptyState>
    );
  }

  const chosen = trend.columns[trend.columns.length - 1];
  const incomplete = trend.columns.filter((c) => c.monthsWithData > 0 && c.monthsWithData < c.monthLabels.length);

  return (
    <>
      <Card>
        <PerformanceControls
          financialYears={trend.financialYears}
          fyStartYear={trend.fyStartYear}
          period={periodValue(trend.period)}
          options={periodOptions()}
        />
      </Card>

      <Card padded={false}>
        <div className="px-3 pt-3">
          <CardTitle
            hint={`${chosen.monthLabels[0]}${chosen.monthLabels.length > 1 ? ` to ${chosen.monthLabels[chosen.monthLabels.length - 1]}` : ""}`}
          >
            {periodLabel(trend.period)}, {chosen.label} against earlier years
          </CardTitle>
        </div>
        <PerformanceTable columns={trend.columns} selectedFy={trend.fyStartYear} taxRate={trend.taxRate} />
      </Card>

      {trend.partialMonth && (
        <Notice tone="caution" title={`${trend.partialMonth.label} is part-way`}>
          The ledger runs to {dateLabel(trend.partialMonth.through)}, so {trend.partialMonth.label} in the
          {" "}{chosen.label} column is the month to date, not the month. It firms up when the rest of the ledger is uploaded.
        </Notice>
      )}

      {incomplete.length > 0 && (
        <Notice tone="caution" title="Some of the period has no figures yet">
          {incomplete
            .map((c) => `${c.label}: ${c.missing.join(", ")} not loaded`)
            .join(" · ")}
          . Those columns add up only the months that exist, so they are not a like-for-like comparison until the
          rest is uploaded
          {trend.ledgerThrough ? ` (the ledger runs to ${dateLabel(trend.ledgerThrough)}, and the last month may be part-way)` : ""}.
        </Notice>
      )}

      <Notice tone="info" title="How these are struck">
        Revenue is fee income. Expenses are the costs of running the firm, depreciation and finance cost
        included. The line beneath them gathers what is neither: interest and other income, reimbursements recovered
        (net of what was spent) and non-operating items. Profit before tax = Revenue − Expenses + that line; tax is
        {" "}{trend.taxRate}% of the period&apos;s profit before tax (nothing on a loss), and profit after tax is what is left.
        Any income-tax provision the accountant booked inside expenses is taken out, so every year is struck the
        same way. A month uploaded from the accountant&apos;s monthly Profit and Loss is read from it; any other month
        comes from the General Ledger.
      </Notice>
    </>
  );
}

async function RevenueTab({ entity }: { entity: Entity }) {
  const trend = await buildCustomerRevenueTrend(entity);

  // Every customer whose row could be expanded on screen - the invoices
  // behind them are fetched once, up front, so the arrow is instant.
  const expandable = new Set<string>();
  for (const r of trend.rows.slice(0, SHOWN_ON_SCREEN)) expandable.add(r.customer);
  for (const r of trend.newCustomers) expandable.add(r.customer);
  const invoicesByCustomerMap = await buildCustomerInvoiceDetailBatch(entity, [...expandable]);
  const invoicesByCustomer = Object.fromEntries(invoicesByCustomerMap);

  const currentYear = trend.years.find((y) => y.isCurrent);
  const currentTotal = currentYear ? (trend.totalByYear[currentYear.fy] ?? 0) : 0;

  return (
    <>
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
        <CustomerTrendTable trend={trend} limit={SHOWN_ON_SCREEN} invoicesByCustomer={invoicesByCustomer} />
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
    </>
  );
}

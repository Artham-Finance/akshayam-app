import { PeriodControls } from "@/components/PeriodControls";
import { SetupRequired } from "@/components/SetupRequired";
import {
  Card,
  CardTitle,
  CompanyOnly,
  EmptyState,
  Notice,
  PageHeader,
} from "@/components/ui";
import { getAvailableFinancialYears, getEntity } from "@/lib/entity";
import { compactINR, dateLabel, money, percent } from "@/lib/format";
import { fyBounds, fyLabel, fyStartYearOf, monthsElapsed } from "@/lib/period";
import { ledgerAsOfLabel, ledgerWrittenTo } from "@/lib/reporting-period";
import { buildDuPont } from "@/lib/reports/dupont";
import { buildBalanceSheet, buildProfitAndLoss } from "@/lib/reports/statements";
import { requireEntityAccess } from "@/lib/auth/dal";
import { DuPontDiagram } from "./components/DuPontDiagram";

export const dynamic = "force-dynamic";

/**
 * DuPont analysis.
 *
 *   RoE = Net Profit Margin × Asset Turnover × Financial Leverage
 *
 * Net Income and Sales come off the P&L, scaled to a full-year run-rate;
 * Assets and Equity are the balance sheet's closing position. A whole-company
 * statement - a slice has no balance sheet to strike leverage against.
 */
export default async function DuPontPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireEntityAccess();
  const params = await searchParams;

  try {
    const entity = await getEntity();
    if (entity.verticalIds) {
      return (
        <>
          <PageHeader title="DuPont Analysis" />
          <CompanyOnly what="DuPont analysis" slice companies={entity.memberIds.length} />
        </>
      );
    }

    const availableYears = await getAvailableFinancialYears(entity.memberIds);
    if (availableYears.length === 0) {
      return (
        <>
          <PageHeader title="DuPont Analysis" />
          <EmptyState title="No ledger data yet" href="/upload" cta="Upload the general ledger">
            DuPont breaks Return on Equity into margin, asset turnover and leverage, all of
            which come from the P&amp;L and the balance sheet. Upload the ledger and the
            opening trial balance and it appears here.
          </EmptyState>
        </>
      );
    }

    const requestedFy = Number(params.fy);
    const fy = availableYears.includes(requestedFy)
      ? requestedFy
      : (availableYears[0] ?? fyStartYearOf());

    const [pnl, bs, writtenTo] = await Promise.all([
      buildProfitAndLoss({ entity, fyStartYear: fy, detail: false }),
      buildBalanceSheet({ entity, fyStartYear: fy, detail: false }),
      ledgerWrittenTo(entity.memberIds, fy),
    ]);

    const { end: fyEnd } = fyBounds(fy, entity.fy_start_month);
    const months = monthsElapsed(fy, writtenTo ?? fyEnd, entity.fy_start_month);
    const asOf = writtenTo ?? fyEnd;

    const data = buildDuPont({ pnl, bs, monthsElapsed: months });
    const { inputs, ratios } = data;

    const pct = (v: number | null) =>
      v === null || !Number.isFinite(v) ? "—" : percent(v * 100, 1);
    const mult = (v: number | null) =>
      v === null || !Number.isFinite(v) ? "—" : `${v.toFixed(2)}×`;

    return (
      <>
        <PageHeader
          title="DuPont Analysis"
          subtitle={`${fyLabel(fy)} · Return on Equity, decomposed${
            months > 0 && months < 12 ? ` · annualised from ${months} month${months === 1 ? "" : "s"}` : ""
          }${ledgerAsOfLabel(writtenTo) ? ` · ${ledgerAsOfLabel(writtenTo)}` : ""}`}
          actions={
            <PeriodControls
              financialYears={availableYears}
              currentFy={fy}
              verticals={[]}
              currentVerticalId={null}
              showVerticalPicker={false}
            />
          }
        />

        <div className="space-y-4">
          <Card>
            <CardTitle hint={`period-end balance sheet · ${dateLabel(asOf)}`}>
              RoE = Net Profit Margin × Asset Turnover × Financial Leverage
            </CardTitle>
            <DuPontDiagram data={data} />
          </Card>

          <Card padded={false}>
            <div className="p-4 sm:p-5">
              <CardTitle>Workings</CardTitle>
            </div>
            <table className="w-full text-[13px]">
              <tbody>
                {[
                  {
                    label: "Net Income (Profit After Tax)",
                    formula:
                      months > 0 && months < 12
                        ? `${compactINR(inputs.netIncomeYtd)} ÷ ${months} × 12`
                        : "year to date",
                    value: compactINR(inputs.netIncome),
                  },
                  {
                    label: "Sales (Revenue from Operations)",
                    formula:
                      months > 0 && months < 12
                        ? `${compactINR(inputs.salesYtd)} ÷ ${months} × 12`
                        : "year to date",
                    value: compactINR(inputs.sales),
                  },
                  {
                    label: "Total Assets",
                    formula: `balance sheet, ${dateLabel(asOf)}`,
                    value: compactINR(inputs.totalAssets),
                  },
                  {
                    label: "Total Equity",
                    formula: "Partners'/Share Capital + Reserves & Surplus",
                    value: compactINR(inputs.totalEquity),
                  },
                ].map((r) => (
                  <tr key={r.label} className="border-t border-line">
                    <td className="px-4 py-2.5 sm:px-5">{r.label}</td>
                    <td className="px-4 py-2.5 text-ink-muted">{r.formula}</td>
                    <td className="num px-4 py-2.5 text-right font-medium sm:px-5">{r.value}</td>
                  </tr>
                ))}

                {[
                  {
                    label: "Net Profit Margin",
                    formula: `${compactINR(inputs.netIncome)} ÷ ${compactINR(inputs.sales)}`,
                    value: pct(ratios.netProfitMargin),
                  },
                  {
                    label: "Asset Turnover",
                    formula: `${compactINR(inputs.sales)} ÷ ${compactINR(inputs.totalAssets)}`,
                    value: mult(ratios.assetTurnover),
                  },
                  {
                    label: "Return on Assets",
                    formula: "Net Profit Margin × Asset Turnover",
                    value: pct(ratios.returnOnAssets),
                  },
                  {
                    label: "Financial Leverage",
                    formula: `${compactINR(inputs.totalAssets)} ÷ ${compactINR(inputs.totalEquity)}`,
                    value: mult(ratios.financialLeverage),
                  },
                ].map((r) => (
                  <tr key={r.label} className="border-t border-line">
                    <td className="px-4 py-2.5 sm:px-5">{r.label}</td>
                    <td className="px-4 py-2.5 text-ink-muted">{r.formula}</td>
                    <td className="num px-4 py-2.5 text-right font-medium sm:px-5">{r.value}</td>
                  </tr>
                ))}

                <tr className="border-t-2 border-line-strong bg-surface-sunk/40 font-semibold">
                  <td className="px-4 py-3 sm:px-5">Return on Equity</td>
                  <td className="px-4 py-3 text-ink-muted">
                    Return on Assets × Financial Leverage = Net Income ÷ Total Equity
                  </td>
                  <td className="num px-4 py-3 text-right sm:px-5">{pct(ratios.returnOnEquity)}</td>
                </tr>
              </tbody>
            </table>
            <p className="px-4 pb-4 pt-3 text-[11.5px] text-ink-muted sm:px-5">
              Net Income ÷ Total Equity ={" "}
              {inputs.totalEquity > 0
                ? pct(inputs.netIncome / inputs.totalEquity)
                : "—"}{" "}
              — the same figure the three factors multiply to, shown independently as a check.
            </p>
          </Card>

          {data.notes.length > 0 && (
            <Notice tone="info" title="How these figures are struck">
              <ul className="ml-4 list-disc space-y-1">
                {data.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </Notice>
          )}

          {pnl.hasUnmapped && (
            <Notice tone="caution" title={`${money(pnl.unmappedTotal)} of P&L activity is unclassified`}>
              Some ledger accounts have no reporting line yet, so Net Income and Sales here may
              not tie to the P&amp;L until they are assigned in Settings.
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

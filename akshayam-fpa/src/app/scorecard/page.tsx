import clsx from "clsx";
import { SetupRequired } from "@/components/SetupRequired";
import { Card, CardTitle, CompanyOnly, EmptyState, Notice, PageHeader } from "@/components/ui";
import { getAvailableFinancialYears, getEntity } from "@/lib/entity";
import { compactINR, money, percent } from "@/lib/format";
import { fyBounds, fyLabel, fyMonths, fyStartYearOf, type QuarterNo } from "@/lib/period";
import { ledgerAsOfLabel, ledgerWrittenTo } from "@/lib/reporting-period";
import { buildScorecard, WEIGHTS, MGMT_APPRAISAL_DEFAULT } from "@/lib/reports/scorecard";
import { requireEntityAccess } from "@/lib/auth/dal";
import { ScorecardControls } from "./ScorecardControls";

export const dynamic = "force-dynamic";

const BUCKET_LABELS = ["< 30d", "31–60d", "61–90d", "91–180d", "181–365d", "> 1yr"];

/**
 * Vertical Performance Scorecard — the partners' quarterly TL rating, struck
 * from the app's own GL, collections, cost pool and AR snapshot.
 */
export default async function ScorecardPage({
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
          <PageHeader title="Vertical Performance Scorecard" />
          <CompanyOnly
            what="The vertical performance scorecard"
            slice
            companies={entity.memberIds.length}
          />
        </>
      );
    }

    const availableYears = await getAvailableFinancialYears(entity.memberIds);
    if (availableYears.length === 0) {
      return (
        <>
          <PageHeader title="Vertical Performance Scorecard" />
          <EmptyState title="No ledger data yet" href="/upload" cta="Upload the general ledger">
            The scorecard rates each vertical on revenue and collection against budget, their
            share of contribution, and receivables ageing. Upload the ledger, budget and the
            sales reports and it fills in.
          </EmptyState>
        </>
      );
    }

    const fy = availableYears.includes(Number(params.fy))
      ? Number(params.fy)
      : (availableYears[0] ?? fyStartYearOf());

    const writtenTo = await ledgerWrittenTo(entity.memberIds, fy);
    const { end: fyEnd } = fyBounds(fy, entity.fy_start_month);
    const latestQuarter =
      (fyMonths(fy, entity.fy_start_month).filter((m) => m.start <= (writtenTo ?? fyEnd)).at(-1)
        ?.quarter as QuarterNo | undefined) ?? 1;

    const q = ([1, 2, 3, 4].includes(Number(params.q)) ? Number(params.q) : latestQuarter) as QuarterNo;
    const cumulative = params.basis !== "quarter"; // default cumulative

    const data = await buildScorecard({ entity, fyStartYear: fy, quarter: q, cumulative });

    const weightRow = [
      ["Revenue vs budget", WEIGHTS.revenue],
      ["Collection vs budget", WEIGHTS.collection],
      ["Net revenue contribution", WEIGHTS.netRevContrib],
      ["Net collection contribution", WEIGHTS.netCollContrib],
      ["Receivables ageing", WEIGHTS.ageing],
      ["Management appraisal", WEIGHTS.mgmt],
    ] as const;

    const compositeTone = (v: number) =>
      v >= 3
        ? "bg-positive-tint text-positive"
        : v >= 2
          ? "bg-caution-tint text-caution"
          : "bg-negative-tint text-negative";

    const th = "px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-muted";
    const td = "px-3 py-2.5 text-[12.5px]";
    const num = "px-3 py-2.5 text-right text-[12.5px] num";

    return (
      <>
        <PageHeader
          title="Vertical Performance Scorecard"
          subtitle={`${fyLabel(fy)} · ${data.window.label}${cumulative && q > 1 ? " (cumulative)" : ""}${
            ledgerAsOfLabel(writtenTo) ? ` · ${ledgerAsOfLabel(writtenTo)}` : ""
          }`}
          actions={
            <ScorecardControls
              financialYears={availableYears}
              currentFy={fy}
              currentQuarter={q}
              cumulative={cumulative}
            />
          }
        />

        <div className="space-y-4">
          <Card padded={false}>
            <div className="p-4 sm:p-5">
              <CardTitle hint="composite = weighted average of the six metrics">Weightage</CardTitle>
              <div className="flex flex-wrap gap-2">
                {weightRow.map(([label, w]) => (
                  <span
                    key={label}
                    className="rounded-md border border-line bg-surface-sunk/40 px-2.5 py-1 text-[11.5px] text-ink-muted"
                  >
                    {label} <span className="font-semibold text-ink">{percent(w * 100, 0)}</span>
                  </span>
                ))}
              </div>
            </div>
          </Card>

          {/* ---------- Ratings summary ---------- */}
          <Card padded={false}>
            <div className="p-4 sm:p-5">
              <CardTitle hint="each metric 0–4 · composite 0–4">Ratings summary</CardTitle>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-t border-line">
                <thead>
                  <tr className="border-b border-line">
                    <th className={th}>#</th>
                    <th className={th}>Team Lead / Vertical</th>
                    <th className={clsx(th, "text-right")}>Revenue</th>
                    <th className={clsx(th, "text-right")}>Collection</th>
                    <th className={clsx(th, "text-right")}>Net rev. contrib.</th>
                    <th className={clsx(th, "text-right")}>Net coll. contrib.</th>
                    <th className={clsx(th, "text-right")}>Ageing</th>
                    <th className={clsx(th, "text-right")}>Mgmt</th>
                    <th className={clsx(th, "text-right")}>Composite</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r, i) => (
                    <tr key={r.code} className="border-b border-line/70">
                      <td className={clsx(td, "text-ink-muted")}>{i + 1}</td>
                      <td className={clsx(td, "font-medium text-ink")}>{r.label}</td>
                      <td className={num}>{r.ratings.revenue}</td>
                      <td className={num}>{r.ratings.collection}</td>
                      <td className={num}>{r.ratings.netRevContrib}</td>
                      <td className={num}>{r.ratings.netCollContrib}</td>
                      <td className={num}>{r.ratings.ageing ?? "–"}</td>
                      <td className={num}>{r.ratings.mgmt}</td>
                      <td className="px-3 py-2.5 text-right">
                        <span
                          className={clsx(
                            "inline-block rounded-md px-2 py-0.5 text-[12.5px] font-semibold num",
                            compositeTone(r.composite),
                          )}
                        >
                          {r.composite.toFixed(2)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* ---------- Workings ---------- */}
          <WorkingCard
            title="Revenue — budget vs actual"
            head={["Vertical", "Q budget", "Actual", "Achievement", "Rating"]}
            rows={data.rows.map((r) => [
              r.label,
              compactINR(r.revenueBudget),
              compactINR(r.revenueActual),
              r.revenueAchievement === null ? "–" : percent(r.revenueAchievement * 100, 1),
              String(r.ratings.revenue),
            ])}
          />
          <WorkingCard
            title="Collection — budget vs actual"
            head={["Vertical", "Q budget", "Actual", "Achievement", "Rating"]}
            rows={data.rows.map((r) => [
              r.label,
              compactINR(r.collectionBudget),
              compactINR(r.collectionActual),
              r.collectionAchievement === null ? "–" : percent(r.collectionAchievement * 100, 1),
              String(r.ratings.collection),
            ])}
          />
          <WorkingCard
            title="Net revenue contribution"
            head={["Vertical", "Revenue", "Cost", "Contribution", "% of total", "Rating"]}
            rows={data.rows.map((r) => [
              r.label,
              compactINR(r.revenueActual),
              compactINR(r.cost),
              compactINR(r.revenueContribution),
              r.revenueContributionShare === null ? "–" : percent(r.revenueContributionShare * 100, 1),
              String(r.ratings.netRevContrib),
            ])}
          />
          <WorkingCard
            title="Net collection contribution"
            head={["Vertical", "Collection", "Cost", "Contribution", "% of total", "Rating"]}
            rows={data.rows.map((r) => [
              r.label,
              compactINR(r.collectionActual),
              compactINR(r.cost),
              compactINR(r.collectionContribution),
              r.collectionContributionShare === null ? "–" : percent(r.collectionContributionShare * 100, 1),
              String(r.ratings.netCollContrib),
            ])}
          />
          <WorkingCard
            title={`Receivables ageing${data.arAsOf ? ` — as at ${data.arAsOf}` : ""}`}
            head={["Vertical", ...BUCKET_LABELS, "Total", "Wtd avg days", "Rating"]}
            rows={data.rows.map((r) => [
              r.label,
              ...r.ageingBuckets.map((b) => (b ? money(b) : "–")),
              money(r.ageingTotal),
              r.ageingDays === null ? "–" : r.ageingDays.toFixed(0),
              r.ratings.ageing === null ? "–" : String(r.ratings.ageing),
            ])}
          />

          <Notice tone="info" title="How to read this">
            <ul className="ml-4 list-disc space-y-1">
              <li>
                Every metric is scored 0–4 on the workbook&rsquo;s bands; the composite is their
                weighted average (weights above).
              </li>
              <li>
                Budgets are the annual figure × {data.window.months}/12; revenue and collection
                actuals are the ledger&rsquo;s, net of credit notes. Cost is the vertical&rsquo;s
                direct cost plus its apportioned share of common cost.
              </li>
              <li>
                Management appraisal is fixed at {MGMT_APPRAISAL_DEFAULT} for every vertical — it
                is a manual input with no editable store yet.
              </li>
              <li>The VPP payout calculation runs off HR offer-letter data and is not shown here.</li>
            </ul>
          </Notice>
        </div>
      </>
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not reach the database.";
    return <SetupRequired message={message} />;
  }
}

function WorkingCard({
  title,
  head,
  rows,
}: {
  title: string;
  head: string[];
  rows: (string | number)[][];
}) {
  return (
    <Card padded={false}>
      <div className="p-4 sm:p-5">
        <CardTitle>{title}</CardTitle>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-t border-line">
          <thead>
            <tr className="border-b border-line">
              {head.map((h, i) => (
                <th
                  key={h}
                  className={clsx(
                    "px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted",
                    i === 0 ? "text-left" : "text-right",
                  )}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((cells, ri) => (
              <tr key={ri} className="border-b border-line/70">
                {cells.map((c, ci) => (
                  <td
                    key={ci}
                    className={clsx(
                      "px-3 py-2 text-[12.5px]",
                      ci === 0 ? "font-medium text-ink" : "text-right num text-ink-muted",
                    )}
                  >
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

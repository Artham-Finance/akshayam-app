import type { ReactNode } from "react";
import clsx from "clsx";
import { SetupRequired } from "@/components/SetupRequired";
import { Card, CardTitle, EmptyState, Notice, PageHeader } from "@/components/ui";
import { RatingScaleCard } from "@/components/RatingScaleCard";
import { getAvailableFinancialYears, getEntity } from "@/lib/entity";
import { compactINR, money, percent } from "@/lib/format";
import { fyBounds, fyLabel, fyMonths, fyStartYearOf, type QuarterNo } from "@/lib/period";
import { ledgerAsOfLabel, ledgerWrittenTo } from "@/lib/reporting-period";
import {
  buildScorecard,
  resolveScorecardScope,
  ROWS,
  WEIGHTS,
  MGMT_APPRAISAL_DEFAULT,
  type ScorecardRow,
} from "@/lib/reports/scorecard";
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

    // A team lead is granted only their own single-vertical slice. The
    // scorecard is still struck across the whole company (or companies) the
    // slice is cut from, so the contribution shares and the firm totals read
    // the same figure a partner sees; the rows are then narrowed to the
    // vertical(s) the lead owns.
    const { isSlice, benchmark, visibleCodes } = await resolveScorecardScope(entity);

    const availableYears = await getAvailableFinancialYears(benchmark.memberIds);
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

    const writtenTo = await ledgerWrittenTo(benchmark.memberIds, fy);
    const { end: fyEnd } = fyBounds(fy, benchmark.fy_start_month);
    const months = fyMonths(fy, benchmark.fy_start_month);
    const reachedMonths = months.filter((m) => m.start <= (writtenTo ?? fyEnd));
    const latestQuarter = (reachedMonths.at(-1)?.quarter as QuarterNo | undefined) ?? 1;

    const q = ([1, 2, 3, 4].includes(Number(params.q)) ? Number(params.q) : latestQuarter) as QuarterNo;
    const cumulative = params.basis !== "quarter"; // default cumulative

    // A month inside that quarter, when one is picked - "expand to months" on
    // this page. Ignored if it is not actually in the quarter or the ledger
    // has not reached it yet, so a stale link cannot show a period with
    // nothing behind it.
    const requestedMonth = typeof params.m === "string" ? params.m : null;
    const month =
      reachedMonths.find((m) => m.key === requestedMonth && m.quarter === q)?.key ?? null;

    // A partner picking one team lead's row from the picker below, to read it
    // the way that TL would - a slice's own login already narrows to its own
    // row without one, so the picker is not offered there.
    const requestedVertical = typeof params.v === "string" ? params.v : null;
    const pickedCode =
      !isSlice && ROWS.some((r) => r.code === requestedVertical) ? requestedVertical : null;

    const data = await buildScorecard({
      entity: benchmark,
      fyStartYear: fy,
      quarter: q,
      cumulative,
      month,
    });
    // The rows on show: every rated vertical, just the slice's own, or the
    // one a partner picked to read as if they were that team lead.
    const shown = isSlice
      ? visibleCodes
        ? data.rows.filter((r) => visibleCodes!.has(r.code))
        : data.rows
      : pickedCode
        ? data.rows.filter((r) => r.code === pickedCode)
        : data.rows;

    // One vertical on screen - whether because this is a TL's own slice or a
    // partner picked one - reads better with every month a click away than
    // gated behind picking its quarter first.
    const singleVertical = isSlice || pickedCode !== null;

    // The code the whole page is narrowed to, when it is narrowed to one at
    // all - a slice's own code, or the one a partner picked.
    const targetCode = isSlice ? ([...(visibleCodes ?? [])][0] ?? null) : pickedCode;

    /**
     * "This year" or "this quarter" for one vertical reads as a trend, not a
     * single lumped figure - every card below becomes one row per month
     * rather than one row per vertical. A single month already reads as one
     * period on its own, so it keeps the plain single-row shape; so does the
     * all-verticals comparison table, where a trend row per vertical would
     * mean twelve months across eleven verticals - a grid nobody can read.
     */
    // Matches the aggregate's own window exactly - months of the quarter(s),
    // not further cut down to what the ledger has reached - so the footer
    // (still struck from that aggregate) is the sum of the rows above it
    // rather than a number that quietly disagrees with them.
    const monthsInView =
      !month && singleVertical && targetCode
        ? months.filter((m) => (cumulative ? m.quarter <= q : m.quarter === q))
        : [];

    const trend =
      monthsInView.length > 0
        ? await Promise.all(
            monthsInView.map((m) =>
              buildScorecard({
                entity: benchmark,
                fyStartYear: fy,
                quarter: m.quarter,
                cumulative: false,
                month: m.key,
              }),
            ),
          )
        : null;

    const targetLabel = targetCode ? (ROWS.find((r) => r.code === targetCode)?.label ?? targetCode) : "";
    const zeroRow = (code: string, label: string): ScorecardRow => ({
      code,
      label,
      revenueBudget: 0,
      revenueActual: 0,
      revenueAchievement: null,
      collectionBudget: 0,
      collectionActual: 0,
      collectionAchievement: null,
      directCost: 0,
      apportionedCost: 0,
      cost: 0,
      contributionRevenue: 0,
      revenueContribution: 0,
      revenueContributionShare: null,
      collectionContribution: 0,
      collectionContributionShare: null,
      ageingBuckets: [0, 0, 0, 0, 0, 0],
      ageingTotal: 0,
      ageingDays: null,
      ratings: {
        revenue: 0,
        collection: 0,
        netRevContrib: 0,
        netCollContrib: 0,
        ageing: null,
        mgmt: MGMT_APPRAISAL_DEFAULT,
      },
      composite: 0,
    });

    // What every card below actually renders as its rows: one per vertical
    // normally, or - when trend is not null - one per month of the single
    // vertical on screen. A month the trend has no data for still gets its
    // own zero row, so a quiet month reads as quiet rather than disappearing
    // from the table.
    const rowSource: { label: string; row: ScorecardRow }[] = trend
      ? monthsInView.map((m, i) => ({
          label: m.label,
          row: trend[i].rows.find((r) => r.code === targetCode) ?? zeroRow(targetCode!, targetLabel),
        }))
      : shown.map((r) => ({ label: r.label, row: r }));
    const firstColHead = trend ? "Month" : "Vertical";

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

    /** Mild per-cell tint for a 0–4 rating. */
    const rateTone = (v: number | null) =>
      v === null
        ? "text-ink-faint"
        : v >= 3
          ? "bg-positive-tint text-positive"
          : v === 2
            ? "bg-caution-tint text-caution"
            : "bg-negative-tint text-negative";

    const Pill = ({ v }: { v: number | null }) => (
      <span
        className={clsx(
          "inline-block min-w-[26px] rounded-md px-1.5 py-0.5 text-center text-[12.5px] font-semibold num",
          rateTone(v),
        )}
      >
        {v ?? "–"}
      </span>
    );

    const th = "px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-muted";
    const td = "px-3 py-2.5 text-[12.5px]";
    const num = "px-3 py-2.5 text-right text-[12.5px] num";

    // ---- card totals ----
    // Always the whole firm, even on a slice's own scorecard: the footer is
    // the benchmark the team lead is read against, not a sum of what is shown.
    const rows = data.rows;
    const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + f(r), 0);

    // What is actually on screen - one row per vertical normally, or one row
    // per month when trended to a single vertical - summed/averaged on its
    // own, for "this vertical's own total", separate from the firm total.
    const ownRows = rowSource.map((r) => r.row);
    const ownSum = (f: (r: ScorecardRow) => number) => ownRows.reduce((s, r) => s + f(r), 0);
    const avg = (f: (r: ScorecardRow) => number) => (ownRows.length ? ownSum(f) / ownRows.length : 0);
    const pctOf = (part: number, total: number) => (total > 0 ? percent((part / total) * 100, 1) : "–");

    const revBudTot = sum((r) => r.revenueBudget);
    const revActTot = sum((r) => r.revenueActual);
    const collBudTot = sum((r) => r.collectionBudget);
    const collActTot = sum((r) => r.collectionActual);
    const directCostTot = sum((r) => r.directCost);
    const apportCostTot = sum((r) => r.apportionedCost);
    const contribRevTot = sum((r) => r.contributionRevenue);
    const revContribTot = sum((r) => r.revenueContribution);

    const vertRevBudTot = ownSum((r) => r.revenueBudget);
    const vertRevActTot = ownSum((r) => r.revenueActual);
    const vertCollBudTot = ownSum((r) => r.collectionBudget);
    const vertCollActTot = ownSum((r) => r.collectionActual);
    const vertDirectCostTot = ownSum((r) => r.directCost);
    const vertApportCostTot = ownSum((r) => r.apportionedCost);
    const vertContribRevTot = ownSum((r) => r.contributionRevenue);
    const vertRevContribTot = ownSum((r) => r.revenueContribution);

    // The Revenue-vs-budget card counts out-of-books billing; contribution is
    // struck on the ledger only. Their difference is the whole gap between the
    // two firm-total revenue figures, so it is named under the contribution card.
    const osbRows = data.rows
      .map((r) => ({ code: r.label.split(" - ").pop() ?? r.label, osb: r.revenueActual - r.contributionRevenue }))
      .filter((x) => x.osb > 0.5);
    const osbTotal = osbRows.reduce((s, x) => s + x.osb, 0);
    const collContribTot = sum((r) => r.collectionContribution);
    const vertCollContribTot = ownSum((r) => r.collectionContribution);
    const ageBucketTot = [0, 1, 2, 3, 4, 5].map((i) => sum((r) => r.ageingBuckets[i] ?? 0));
    const ageGrandTot = ageBucketTot.reduce((s, b) => s + b, 0);
    const ageBlendedDays =
      ageGrandTot > 0
        ? sum((r) => (r.ageingDays ?? 0) * r.ageingTotal) / ageGrandTot
        : null;

    // The ageing snapshot is a single point in time, not a monthly figure -
    // every month of a trend reads it identically, so repeating it per month
    // is just noise. Only the most recently reached month is shown.
    const ageingRowSource = trend ? rowSource.slice(-1) : rowSource;

    return (
      <>
        <PageHeader
          title="Vertical Performance Scorecard"
          subtitle={`${fyLabel(fy)} · ${data.window.label}${!month && cumulative && q > 1 ? " (cumulative)" : ""}${
            ledgerAsOfLabel(writtenTo) ? ` · ${ledgerAsOfLabel(writtenTo)}` : ""
          }`}
          actions={
            <ScorecardControls
              financialYears={availableYears}
              currentFy={fy}
              currentQuarter={q}
              currentMonth={month}
              cumulative={cumulative}
              months={months}
              reachedQuarter={latestQuarter}
              writtenTo={writtenTo}
              params={params}
              verticalOptions={isSlice ? [] : ROWS.map((r) => ({ code: r.code, label: r.label }))}
              currentVertical={pickedCode}
              alwaysShowMonths={singleVertical}
            />
          }
        />

        <div className="space-y-4">
          {isSlice && (
            <Notice tone="info" title="Your vertical only">
              {shown.length > 0
                ? `Every card below is narrowed to your vertical${trend ? ", one row per month" : ""}; the footer row is the whole firm, as a benchmark.`
                : "Your vertical is not rated on the partners’ scorecard this quarter — it carries no budget or activity in the period, or is not a rated line. The footer rows below are the whole firm."}
            </Notice>
          )}

          {pickedCode && (
            <Notice tone="info" title={`Reading as ${ROWS.find((r) => r.code === pickedCode)?.label}`}>
              {shown.length > 0
                ? `Every card below is narrowed to this vertical${trend ? ", one row per month" : ""}, the same view its team lead sees; the footer row is the whole firm, as a benchmark.`
                : "This vertical is not rated on the partners’ scorecard this period — it carries no budget or activity, or is not a rated line. The footer rows below are the whole firm."}
            </Notice>
          )}

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

          <RatingScaleCard />

          {/* ---------- Ratings summary ---------- */}
          <Card padded={false} className="border-t-2 border-navy">
            <div className="p-4 sm:p-5">
              <CardTitle hint="each metric 0–4 · composite 0–4">Ratings summary</CardTitle>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-t border-line">
                <thead>
                  <tr className="border-b border-line bg-surface-sunk/40">
                    <th className={th}>#</th>
                    <th className={th}>{trend ? "Month" : "Team Lead / Vertical"}</th>
                    <th className={clsx(th, "text-center")}>Revenue</th>
                    <th className={clsx(th, "text-center")}>Collection</th>
                    <th className={clsx(th, "text-center")}>Net rev. contrib.</th>
                    <th className={clsx(th, "text-center")}>Net coll. contrib.</th>
                    <th className={clsx(th, "text-center")}>Ageing</th>
                    <th className={clsx(th, "text-center")}>Mgmt</th>
                    <th className={clsx(th, "text-center")}>Composite</th>
                  </tr>
                </thead>
                <tbody>
                  {rowSource.map(({ label, row }, i) => (
                    <tr key={label} className="border-b border-line/70 odd:bg-surface-sunk/20">
                      <td className={clsx(td, "text-ink-muted")}>{i + 1}</td>
                      <td className={clsx(td, "font-medium text-ink")}>{label}</td>
                      <td className="px-3 py-2 text-center"><Pill v={row.ratings.revenue} /></td>
                      <td className="px-3 py-2 text-center"><Pill v={row.ratings.collection} /></td>
                      <td className="px-3 py-2 text-center"><Pill v={row.ratings.netRevContrib} /></td>
                      <td className="px-3 py-2 text-center"><Pill v={row.ratings.netCollContrib} /></td>
                      <td className="px-3 py-2 text-center"><Pill v={row.ratings.ageing} /></td>
                      <td className="px-3 py-2 text-center"><Pill v={row.ratings.mgmt} /></td>
                      <td className="px-3 py-2.5 text-center">
                        <span
                          className={clsx(
                            "inline-block rounded-md px-2 py-0.5 text-[12.5px] font-semibold num",
                            compositeTone(row.composite),
                          )}
                        >
                          {row.composite.toFixed(2)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-line-strong bg-surface-sunk/50 font-semibold">
                    <td className={td} />
                    <td className={clsx(td, "text-ink")}>Average</td>
                    <td className={clsx(num, "text-center")}>{avg((r) => r.ratings.revenue).toFixed(1)}</td>
                    <td className={clsx(num, "text-center")}>{avg((r) => r.ratings.collection).toFixed(1)}</td>
                    <td className={clsx(num, "text-center")}>{avg((r) => r.ratings.netRevContrib).toFixed(1)}</td>
                    <td className={clsx(num, "text-center")}>{avg((r) => r.ratings.netCollContrib).toFixed(1)}</td>
                    <td className={clsx(num, "text-center")}>{avg((r) => r.ratings.ageing ?? 0).toFixed(1)}</td>
                    <td className={clsx(num, "text-center")}>{avg((r) => r.ratings.mgmt).toFixed(1)}</td>
                    <td className={clsx(num, "text-center")}>{avg((r) => r.composite).toFixed(2)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>

          {/* ---------- Workings ---------- */}
          <WorkingCard
            title="Revenue — budget vs actual"
            accent="border-navy"
            head={[firstColHead, "Period budget", "Actual", "Achievement", "Rating"]}
            rows={rowSource.map(({ label, row }) => ({
              cells: [
                label,
                compactINR(row.revenueBudget),
                compactINR(row.revenueActual),
                row.revenueAchievement === null ? "–" : percent(row.revenueAchievement * 100, 1),
              ],
              rating: row.ratings.revenue,
            }))}
            subFoot={
              singleVertical
                ? [
                    [
                      "Vertical total",
                      compactINR(vertRevBudTot),
                      compactINR(vertRevActTot),
                      pctOf(vertRevActTot, vertRevBudTot),
                      "",
                    ],
                    [
                      "% of firm total",
                      pctOf(vertRevBudTot, revBudTot),
                      pctOf(vertRevActTot, revActTot),
                      "–",
                      "",
                    ],
                  ]
                : undefined
            }
            foot={[
              singleVertical ? "Firm total" : "Total",
              compactINR(revBudTot),
              compactINR(revActTot),
              revBudTot > 0 ? percent((revActTot / revBudTot) * 100, 1) : "–",
              "",
            ]}
          />
          <WorkingCard
            title="Collection — budget vs actual"
            accent="border-navy"
            head={[firstColHead, "Period budget", "Actual", "Achievement", "Rating"]}
            rows={rowSource.map(({ label, row }) => ({
              cells: [
                label,
                compactINR(row.collectionBudget),
                compactINR(row.collectionActual),
                row.collectionAchievement === null ? "–" : percent(row.collectionAchievement * 100, 1),
              ],
              rating: row.ratings.collection,
            }))}
            subFoot={
              singleVertical
                ? [
                    [
                      "Vertical total",
                      compactINR(vertCollBudTot),
                      compactINR(vertCollActTot),
                      pctOf(vertCollActTot, vertCollBudTot),
                      "",
                    ],
                    [
                      "% of firm total",
                      pctOf(vertCollBudTot, collBudTot),
                      pctOf(vertCollActTot, collActTot),
                      "–",
                      "",
                    ],
                  ]
                : undefined
            }
            foot={[
              singleVertical ? "Firm total" : "Total",
              compactINR(collBudTot),
              compactINR(collActTot),
              collBudTot > 0 ? percent((collActTot / collBudTot) * 100, 1) : "–",
              "",
            ]}
          />
          <WorkingCard
            title="Net revenue contribution"
            accent="border-positive"
            head={[
              firstColHead,
              "Revenue",
              "Direct cost",
              "Apportioned cost",
              "Contribution",
              "% of total",
              "Rating",
            ]}
            rows={rowSource.map(({ label, row }) => ({
              cells: [
                label,
                compactINR(row.contributionRevenue),
                compactINR(row.directCost),
                compactINR(row.apportionedCost),
                compactINR(row.revenueContribution),
                row.revenueContributionShare === null ? "–" : percent(row.revenueContributionShare * 100, 1),
              ],
              rating: row.ratings.netRevContrib,
            }))}
            subFoot={
              singleVertical
                ? [
                    [
                      "Vertical total",
                      compactINR(vertContribRevTot),
                      compactINR(vertDirectCostTot),
                      compactINR(vertApportCostTot),
                      compactINR(vertRevContribTot),
                      pctOf(vertRevContribTot, revContribTot),
                      "",
                    ],
                    [
                      "% of firm total",
                      pctOf(vertContribRevTot, contribRevTot),
                      pctOf(vertDirectCostTot, directCostTot),
                      pctOf(vertApportCostTot, apportCostTot),
                      pctOf(vertRevContribTot, revContribTot),
                      "–",
                      "",
                    ],
                  ]
                : undefined
            }
            foot={[
              singleVertical ? "Firm total" : "Total",
              compactINR(contribRevTot),
              compactINR(directCostTot),
              compactINR(apportCostTot),
              compactINR(revContribTot),
              percent(100, 0),
              "",
            ]}
            note={
              osbTotal > 0.5 ? (
                <>
                  Revenue here is the ledger&rsquo;s. A further{" "}
                  <span className="num font-medium">{compactINR(osbTotal)}</span> of
                  out-of-books billing ({osbRows.map((x) => x.code).join(", ")}) is rated
                  against budget in the Revenue card above but left out here — it carries
                  no cost, so counting it would overstate contribution. That is the whole
                  of the difference between the two firm-total revenue figures{" "}
                  ({compactINR(revActTot)} vs {compactINR(contribRevTot)}).
                </>
              ) : undefined
            }
          />
          <WorkingCard
            title="Net collection contribution"
            accent="border-positive"
            head={[
              firstColHead,
              "Collection",
              "Direct cost",
              "Apportioned cost",
              "Contribution",
              "% of total",
              "Rating",
            ]}
            rows={rowSource.map(({ label, row }) => ({
              cells: [
                label,
                compactINR(row.collectionActual),
                compactINR(row.directCost),
                compactINR(row.apportionedCost),
                compactINR(row.collectionContribution),
                row.collectionContributionShare === null ? "–" : percent(row.collectionContributionShare * 100, 1),
              ],
              rating: row.ratings.netCollContrib,
            }))}
            subFoot={
              singleVertical
                ? [
                    [
                      "Vertical total",
                      compactINR(vertCollActTot),
                      compactINR(vertDirectCostTot),
                      compactINR(vertApportCostTot),
                      compactINR(vertCollContribTot),
                      pctOf(vertCollContribTot, collContribTot),
                      "",
                    ],
                    [
                      "% of firm total",
                      pctOf(vertCollActTot, collActTot),
                      pctOf(vertDirectCostTot, directCostTot),
                      pctOf(vertApportCostTot, apportCostTot),
                      pctOf(vertCollContribTot, collContribTot),
                      "–",
                      "",
                    ],
                  ]
                : undefined
            }
            foot={[
              singleVertical ? "Firm total" : "Total",
              compactINR(collActTot),
              compactINR(directCostTot),
              compactINR(apportCostTot),
              compactINR(collContribTot),
              percent(100, 0),
              "",
            ]}
          />
          <WorkingCard
            title={`Receivables ageing${data.arAsOf ? ` — as at ${data.arAsOf}` : ""}`}
            accent="border-caution"
            head={[firstColHead, ...BUCKET_LABELS, "Total", "Wtd avg days", "Rating"]}
            rows={ageingRowSource.map(({ label, row }) => ({
              cells: [
                label,
                ...row.ageingBuckets.map((b) => (b ? money(b) : "–")),
                money(row.ageingTotal),
                row.ageingDays === null ? "–" : row.ageingDays.toFixed(0),
              ],
              rating: row.ratings.ageing,
            }))}
            subFoot={
              singleVertical && ageingRowSource[0]
                ? [
                    [
                      "% of firm total",
                      ...ageingRowSource[0].row.ageingBuckets.map((b, i) => pctOf(b, ageBucketTot[i] ?? 0)),
                      pctOf(ageingRowSource[0].row.ageingTotal, ageGrandTot),
                      "–",
                      "",
                    ],
                  ]
                : undefined
            }
            foot={[
              singleVertical ? "Firm total" : "Total",
              ...ageBucketTot.map((b) => (b ? money(b) : "–")),
              money(ageGrandTot),
              ageBlendedDays === null ? "–" : ageBlendedDays.toFixed(0),
              "",
            ]}
          />

          <Notice tone="info" title="How to read this">
            <ul className="ml-4 list-disc space-y-1">
              <li>
                Every metric is scored 0–4 on the workbook&rsquo;s bands; the composite is their
                weighted average (weights above).
              </li>
              <li>
                Budgets are the annual figure × {data.window.months}/12; revenue and collection
                actuals are the ledger&rsquo;s, net of credit notes. Cost is shown in two parts —
                the vertical&rsquo;s own directly-tagged cost, and its apportioned share of the
                common pool — and contribution is struck after both. The revenue on the
                contribution card is ledger revenue only; any out-of-books billing is rated
                against budget above but has no cost beneath it, so it is left off here.
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

function ratePill(v: number | null) {
  const tone =
    v === null
      ? "text-ink-faint"
      : v >= 3
        ? "bg-positive-tint text-positive"
        : v === 2
          ? "bg-caution-tint text-caution"
          : "bg-negative-tint text-negative";
  return (
    <span
      className={clsx(
        "inline-block min-w-[24px] rounded px-1.5 py-0.5 text-center text-[12px] font-semibold num",
        tone,
      )}
    >
      {v ?? "–"}
    </span>
  );
}

function WorkingCard({
  title,
  accent,
  head,
  rows,
  subFoot,
  foot,
  note,
}: {
  title: string;
  /** border-* colour token for the card's top accent */
  accent: string;
  head: string[];
  rows: { cells: (string | number)[]; rating: number | null }[];
  /** extra, lighter total rows shown above the main foot row - e.g. one vertical's own total and its share of the firm */
  subFoot?: (string | number)[][];
  foot?: (string | number)[];
  /** an explanatory line shown under the table */
  note?: ReactNode;
}) {
  return (
    <Card padded={false} className={clsx("border-t-2", accent)}>
      <div className="p-4 sm:p-5">
        <CardTitle>{title}</CardTitle>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-t border-line">
          <thead>
            <tr className="border-b border-line bg-surface-sunk/40">
              {head.map((h, i) => (
                <th
                  key={h}
                  className={clsx(
                    "px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted",
                    i === 0 ? "text-left" : i === head.length - 1 ? "text-center" : "text-right",
                  )}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ cells, rating }, ri) => (
              <tr key={ri} className="border-b border-line/70 odd:bg-surface-sunk/20">
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
                <td className="px-3 py-2 text-center">{ratePill(rating)}</td>
              </tr>
            ))}
          </tbody>
          {(subFoot || foot) && (
            <tfoot>
              {subFoot?.map((cells, ri) => (
                <tr
                  key={`sub-${ri}`}
                  className={clsx(
                    "border-t border-line bg-surface-sunk/25",
                    ri === 0 ? "font-semibold text-ink" : "text-ink-muted",
                  )}
                >
                  {cells.map((c, ci) => (
                    <td
                      key={ci}
                      className={clsx(
                        "px-3 py-2 text-[12px]",
                        ci === 0 ? "text-left font-medium" : "text-right num",
                      )}
                    >
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
              {foot && (
                <tr className="border-t-2 border-line-strong bg-surface-sunk/50 font-semibold text-ink">
                  {foot.map((c, ci) => (
                    <td
                      key={ci}
                      className={clsx(
                        "px-3 py-2.5 text-[12.5px]",
                        ci === 0 ? "text-left" : "text-right num",
                      )}
                    >
                      {c}
                    </td>
                  ))}
                </tr>
              )}
            </tfoot>
          )}
        </table>
      </div>
      {note && (
        <p className="border-t border-line px-4 py-3 text-[11.5px] leading-relaxed text-ink-muted sm:px-5">
          {note}
        </p>
      )}
    </Card>
  );
}

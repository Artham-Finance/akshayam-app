import { ApportionmentTable } from "@/components/ApportionmentTable";
import { CommonSize } from "@/components/BvaTable";
import { PeriodControls } from "@/components/PeriodControls";
import { QuarterTabs } from "@/components/QuarterTabs";
import { SetupRequired } from "@/components/SetupRequired";
import { StatementTable, type ClientLine } from "@/components/StatementTable";
import { VerticalContributionCard } from "@/components/VerticalContributionCard";
import {
  Card,
  CardTitle,
  EmptyState,
  Notice,
  PageHeader,
  DownloadExcel,
} from "@/components/ui";
import {
  countUnmappedAccounts,
  getAvailableFinancialYears,
  getEntity,
  getVerticals,
} from "@/lib/entity";
import { withParams } from "@/lib/href";
import { compactINR } from "@/lib/format";
import { fyBounds, fyMonths, type QuarterNo } from "@/lib/period";
import {
  getReportingPeriod,
  ledgerAsOfLabel,
  ledgerWrittenTo,
} from "@/lib/reporting-period";
import { buildApportionment, receiverKeyFor } from "@/lib/reports/apportionment";
import { buildBudgetVsActualPnl } from "@/lib/reports/budget-pnl";
import {
  buildScorecard,
  resolveScorecardScope,
  type ScorecardRow,
} from "@/lib/reports/scorecard";
import { buildProfitAndLoss } from "@/lib/reports/statements";
import { can, requireEntityAccess } from "@/lib/auth/dal";

export const dynamic = "force-dynamic";

export default async function ProfitAndLossPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireEntityAccess();
  const params = await searchParams;

  try {
    const entity = await getEntity();
    const [verticals, availableYears, unmapped, canEditHeads] = await Promise.all([
      getVerticals(entity),
      getAvailableFinancialYears(entity.memberIds),
      countUnmappedAccounts(entity.memberIds),
      can("verticals.manage"),
    ]);

    if (availableYears.length === 0) {
      return (
        <>
          <PageHeader title="Profit & Loss" />
          <EmptyState
            title="No ledger data yet"
            href="/upload"
            cta="Upload the general ledger"
          >
            Upload the Zoho Books general ledger for the financial year and the
            monthly P&amp;L will be built from it. Every figure stays traceable
            back to the transactions behind it.
          </EmptyState>
        </>
      );
    }

    // The global reporting period from the header picker.
    const preview = await getReportingPeriod(entity, availableYears);
    const writtenTo = await ledgerWrittenTo(entity.memberIds, preview.fyStartYear);
    const period = await getReportingPeriod(entity, availableYears, writtenTo);
    const fy = period.fyStartYear;
    const window = { start: period.start, end: period.end };

    // A team lead signs in against a single-vertical slice; the P&L is then
    // their own vertical's, with a contribution card that ties to the scorecard.
    const scope = await resolveScorecardScope(entity);

    const requestedVertical = Number(params.vertical);
    const verticalId = verticals.some((v) => v.id === requestedVertical)
      ? requestedVertical
      : null;
    const verticalName =
      verticals.find((v) => v.id === verticalId)?.name ?? null;

    const statement = await buildProfitAndLoss({
      entity,
      fyStartYear: fy,
      verticalId,
      window,
    });

    /**
     * The two vertical-wise sections that used to live on Budget vs Actual.
     *
     * Common size belongs here because it is the P&L restated, not a
     * comparison against budget; apportionment belongs here because it is the
     * P&L by vertical once shared cost is charged out. Both are read after the
     * statement they are derived from.
     */
    const months = fyMonths(fy);
    // The apportionment card defaults to the last quarter the period touches.
    const reachedQuarter =
      period.periodMonths[period.periodMonths.length - 1]?.quarter ?? months[0].quarter;

    const requestedQuarter = /^q([1-4])$/.exec(String(params.q ?? ""));
    const quarter: QuarterNo = requestedQuarter
      ? (Number(requestedQuarter[1]) as QuarterNo)
      : reachedQuarter;

    // A month inside that quarter, when one is picked. Ignored if it is not
    // actually in the quarter, so a stale link cannot show a mismatched pair.
    const requestedMonth = typeof params.qm === "string" ? params.qm : null;
    const apportionMonth =
      months.find((m) => m.key === requestedMonth && m.quarter === quarter)?.key ?? null;

    const [bva, apportionment] = await Promise.all([
      buildBudgetVsActualPnl({ entity, fyStartYear: fy, verticalId, window }),
      /**
       * Always struck across every vertical, even when one is picked.
       *
       * Common cost is spread over the verticals that use it, so computing it
       * for one alone would hand that vertical the whole pool. The spread is
       * the company's; only the column shown narrows to the picker.
       *
       * A slice gets the scorecard-matching card instead, so this is skipped.
       */
      scope.isSlice
        ? null
        : buildApportionment({ entity, fyStartYear: fy, quarter, month: apportionMonth }),
    ]);

    /**
     * A team lead's net revenue contribution, struck exactly as the Vertical
     * Performance Scorecard does it - the whole book the slice is cut from,
     * cumulative to the last quarter the ledger reaches - then narrowed to
     * their own row. Same builder, so the two pages cannot disagree.
     */
    const contribution = await buildSliceContribution({
      scope,
      fy,
      writtenTo,
      sliceVerticalCodes: verticals.map((v) => v.code),
    });

    /**
     * The table, narrowed to the picked vertical.
     *
     * AIF and GIFT share one column, so the code is resolved through the
     * apportionment's own mapping rather than matched directly. A vertical the
     * budget does not apportion to - Common, partner contribution - resolves to
     * nothing, and the table is left out rather than shown empty.
     */
    const focusCode = verticals.find((v) => v.id === verticalId)?.code ?? null;
    // The lines outside the budget's nine - Common, partner contribution -
    // are keyed on their own code, so a vertical that receives no
    // apportionment still has a column of its own to show.
    const focusKey = receiverKeyFor(focusCode) ?? focusCode;
    const shownApportionment =
      !apportionment || verticalId === null
        ? apportionment
        : {
            ...apportionment,
            verticals: apportionment.verticals.filter((v) => v.key === focusKey),
          };

    const lines: ClientLine[] = statement.lines.map((line) => ({
      key: line.key,
      name: line.name,
      level: line.level,
      isSubtotal: line.isSubtotal,
      sign: line.sign,
      groupCode: line.groupCode,
      accountId: line.accountId,
      values: line.values,
    }));

    return (
      <>
        <PageHeader
          title="Profit & Loss"
          subtitle={
            <>
              {period.label}
              {verticalName
                ? ` · ${verticalName}`
                : scope.isSlice
                  ? ` · ${verticals.map((v) => v.name).join(" + ")}`
                  : " · All verticals"}
              {ledgerAsOfLabel(writtenTo) ? ` · ${ledgerAsOfLabel(writtenTo)}` : ""} · click
              a quarter heading to open its months
            </>
          }
          actions={
            <>
              <PeriodControls
                financialYears={[]}
                currentFy={0}
                verticals={scope.isSlice ? [] : verticals.map((v) => ({ id: v.id, name: v.name }))}
                currentVerticalId={verticalId}
              />
              <DownloadExcel
                href={withParams("/api/export", params, {
                  kind: "pnl",
                  vertical: verticalId,
                  drill: null,
                })}
              />
            </>
          }
        />

        <div className="space-y-4">
          {verticals.length === 0 &&
            (entity.isGroup ? (
              <Notice
                tone="info"
                title="Vertical-wise view not available on the group"
              >
                The two companies tag their ledgers with different schemes —
                RBJV by practice area, Akshayam by GIFT, Legal and Regulatory —
                so there is no vertical that means the same thing in both. The
                consolidated P&amp;L is therefore shown for the group as a
                whole; switch to a company for its own vertical split.
              </Notice>
            ) : (
              <Notice tone="info" title="Vertical-wise view not available">
                This ledger has no reporting tags, so the P&amp;L can only be
                shown for the company as a whole. Re-export the general ledger
                from Zoho with reporting tags included to unlock the vertical
                picker.
              </Notice>
            ))}

          {statement.hasUnmapped && (
            <Notice
              tone="negative"
              title={`${compactINR(statement.unmappedTotal)} of activity is missing from this statement`}
              action={
                <a
                  href="/settings/accounts"
                  className="whitespace-nowrap rounded-md border border-negative/30 px-2.5 py-1.5 text-[12px] font-medium hover:bg-negative/10"
                >
                  Assign accounts
                </a>
              }
            >
              Some accounts have no reporting line at all, so their amounts
              appear nowhere below. Assign them before using these figures.
            </Notice>
          )}

          {unmapped > 0 && (
            <Notice
              tone="caution"
              title={`${unmapped} account${unmapped === 1 ? "" : "s"} classified automatically`}
              action={
                <a
                  href="/settings/accounts"
                  className="whitespace-nowrap rounded-md border border-caution/30 px-2.5 py-1.5 text-[12px] font-medium hover:bg-caution/10"
                >
                  Review mapping
                </a>
              }
            >
              Their amounts <span className="font-medium">are included</span> in
              the figures below, but the reporting line was guessed rather than
              confirmed. Worth a look before this goes to the client.
            </Notice>
          )}

          <StatementTable
            months={statement.months}
            lines={lines}
            emphasise={["gross_profit", "ebitda", "pat"]}
            totalLabel={period.periodMonths.length < 12 ? period.shortLabel : undefined}
          />

          {contribution && (
            <Card padded={false}>
              <div className="px-4 pt-4 sm:px-5">
                <CardTitle hint={`${contribution.quarterLabel} · as on the scorecard`}>
                  Net revenue contribution — direct &amp; apportioned cost
                </CardTitle>
              </div>
              <VerticalContributionCard
                rows={contribution.rows}
                firmTotals={contribution.firmTotals}
                apportionedByHead={contribution.apportionedByHead}
              />
            </Card>
          )}

          <Card padded={false}>
            <div className="px-4 pt-4 sm:px-5">
              <CardTitle hint="percentage of revenue">
                Common-size P&amp;L by month
              </CardTitle>
            </div>
            <CommonSize
              lines={bva.lines}
              months={bva.months}
              budgetColumn={bva.hasBudget}
            />
          </Card>

          {shownApportionment?.applicable && shownApportionment.verticals.length > 0 && (
            <Card padded={false}>
              <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4 sm:px-5">
                <CardTitle hint={`${shownApportionment.label} · for VPP`}>
                  Vertical-wise P&amp;L, after cost apportionment
                </CardTitle>
                <QuarterTabs
                  current={quarter}
                  currentMonth={apportionMonth}
                  reached={reachedQuarter}
                  months={months}
                  writtenTo={writtenTo}
                  hrefFor={(q, m) => withParams("/pnl", params, { q: `q${q}`, qm: m })}
                />
              </div>
              <ApportionmentTable data={shownApportionment} canEditHeads={canEditHeads} />
              {verticalId === null && apportionment && apportionment.outside.length > 0 && (
                <p className="px-4 pb-4 text-[11.5px] text-ink-muted sm:px-5">
                  Outside the nine budgeted verticals:{" "}
                  {apportionment.outside
                    .map(
                      (o) =>
                        `${o.label} — revenue ${Math.round(o.revenue).toLocaleString("en-IN")}, cost ${Math.round(o.directCost).toLocaleString("en-IN")}`,
                    )
                    .join("; ")}
                  . These carry no apportionment: the budget spreads common cost
                  over nine verticals and these are not among them.
                </p>
              )}
            </Card>
          )}
        </div>
      </>
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not reach the database.";
    return <SetupRequired message={message} />;
  }
}

/**
 * A team lead's net revenue contribution, struck exactly as the Vertical
 * Performance Scorecard strikes it - the whole book the slice is cut from,
 * cumulative to the last quarter the ledger reaches - then narrowed to their
 * own row. Uses the same builder as the scorecard, so the numbers match; the
 * per-head apportioned breakdown is folded from the same quarters.
 */
async function buildSliceContribution(opts: {
  scope: Awaited<ReturnType<typeof resolveScorecardScope>>;
  fy: number;
  writtenTo: string | null;
  sliceVerticalCodes: string[];
}): Promise<{
  rows: ScorecardRow[];
  firmTotals: {
    revenue: number;
    directCost: number;
    apportionedCost: number;
    contribution: number;
  };
  apportionedByHead: Record<string, number>;
  quarterLabel: string;
} | null> {
  const { scope, fy, writtenTo, sliceVerticalCodes } = opts;
  if (!scope.isSlice || !scope.visibleCodes || scope.visibleCodes.size === 0) {
    return null;
  }

  const { end: fyEnd } = fyBounds(fy, scope.benchmark.fy_start_month);
  const latestQuarter =
    (fyMonths(fy, scope.benchmark.fy_start_month)
      .filter((m) => m.start <= (writtenTo ?? fyEnd))
      .at(-1)?.quarter as QuarterNo | undefined) ?? 1;
  const quartersInRange = ([1, 2, 3, 4] as QuarterNo[]).filter((q) => q <= latestQuarter);

  const [sc, aps] = await Promise.all([
    buildScorecard({
      entity: scope.benchmark,
      fyStartYear: fy,
      quarter: latestQuarter,
      cumulative: true,
    }),
    Promise.all(
      quartersInRange.map((q) =>
        buildApportionment({ entity: scope.benchmark, fyStartYear: fy, quarter: q }),
      ),
    ),
  ]);

  const rows = sc.rows.filter((r) => scope.visibleCodes!.has(r.code));
  if (rows.length === 0) return null;

  const focusKeys = new Set(
    sliceVerticalCodes
      .map((c) => receiverKeyFor(c))
      .filter((k): k is string => k !== null),
  );
  const apportionedByHead: Record<string, number> = {};
  for (const ap of aps) {
    for (const v of ap.verticals) {
      if (!focusKeys.has(v.key)) continue;
      for (const [h, amt] of Object.entries(v.apportioned)) {
        apportionedByHead[h] = (apportionedByHead[h] ?? 0) + Number(amt);
      }
    }
  }

  return {
    rows,
    firmTotals: {
      revenue: sc.rows.reduce((s, r) => s + r.contributionRevenue, 0),
      directCost: sc.rows.reduce((s, r) => s + r.directCost, 0),
      apportionedCost: sc.rows.reduce((s, r) => s + r.apportionedCost, 0),
      contribution: sc.rows.reduce((s, r) => s + r.revenueContribution, 0),
    },
    apportionedByHead,
    quarterLabel: sc.window.label,
  };
}

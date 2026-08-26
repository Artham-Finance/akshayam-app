import { ApportionmentTable } from "@/components/ApportionmentTable";
import { CommonSize } from "@/components/BvaTable";
import { PeriodControls } from "@/components/PeriodControls";
import { QuarterTabs } from "@/components/QuarterTabs";
import { SetupRequired } from "@/components/SetupRequired";
import { StatementTable, type ClientLine } from "@/components/StatementTable";
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
import { fyLabel, fyMonths, fyStartYearOf, type QuarterNo } from "@/lib/period";
import { ledgerWrittenTo } from "@/lib/reporting-period";
import { buildApportionment } from "@/lib/reports/apportionment";
import { buildBudgetVsActualPnl } from "@/lib/reports/budget-pnl";
import { buildProfitAndLoss } from "@/lib/reports/statements";
import { requireEntityAccess } from "@/lib/auth/dal";

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
    const [verticals, availableYears, unmapped] = await Promise.all([
      getVerticals(entity),
      getAvailableFinancialYears(entity.memberIds),
      countUnmappedAccounts(entity.memberIds),
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

    const requestedFy = Number(params.fy);
    const fy = availableYears.includes(requestedFy)
      ? requestedFy
      : (availableYears[0] ?? fyStartYearOf());

    const requestedVertical = Number(params.vertical);
    const verticalId = verticals.some((v) => v.id === requestedVertical)
      ? requestedVertical
      : null;
    const verticalName =
      verticals.find((v) => v.id === verticalId)?.name ?? null;

    // Neither of these needs the other, so they go together rather than one
    // after the next.
    const [statement, writtenTo] = await Promise.all([
      buildProfitAndLoss({ entity, fyStartYear: fy, verticalId }),
      ledgerWrittenTo(entity.memberIds, fy),
    ]);

    /**
     * The two vertical-wise sections that used to live on Budget vs Actual.
     *
     * Common size belongs here because it is the P&L restated, not a
     * comparison against budget; apportionment belongs here because it is the
     * P&L by vertical once shared cost is charged out. Both are read after the
     * statement they are derived from.
     */
    const months = fyMonths(fy);
    const reachedQuarter = (months
      .filter((m) => !writtenTo || m.start <= writtenTo)
      .pop() ?? months[0]).quarter;

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
      buildBudgetVsActualPnl({ entity, fyStartYear: fy, verticalId }),
      // The split is across every vertical at once, so picking one on the
      // statement above would leave this table with a single column and
      // nothing to apportion between.
      verticalId === null
        ? buildApportionment({ entity, fyStartYear: fy, quarter, month: apportionMonth })
        : null,
    ]);

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
              {fyLabel(fy)}
              {verticalName ? ` · ${verticalName}` : " · All verticals"} · click
              a quarter heading to open its months
            </>
          }
          actions={
            <>
              <PeriodControls
                financialYears={availableYears}
                currentFy={fy}
                verticals={verticals.map((v) => ({ id: v.id, name: v.name }))}
                currentVerticalId={verticalId}
              />
              <DownloadExcel
                href={withParams("/api/export", params, {
                  kind: "pnl",
                  fy,
                  vertical: verticalId,
                  drill: null,
                  period: null,
                  week: null,
                  month: null,
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
          />

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

          {apportionment?.applicable && (
            <Card padded={false}>
              <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4 sm:px-5">
                <CardTitle hint={`${apportionment.label} · for VPP`}>
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
              <ApportionmentTable data={apportionment} />
              {apportionment.outside.length > 0 && (
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

import Link from "next/link";
import { BvaStatement } from "@/components/BvaTable";
import { EstablishmentCostTable } from "@/components/EstablishmentCostTable";
import { ExpenseDetailTable } from "@/components/ExpenseDetailTable";
import { TeamCostTable } from "@/components/TeamCostTable";
import { SetupRequired } from "@/components/SetupRequired";
import {
  Card,
  CardTitle,
  CompanyOnly,
  EmptyState,
  Notice,
  PageHeader,
  DownloadExcel,
} from "@/components/ui";
import {
  getAvailableFinancialYears,
  getEntity,
  getVerticals,
} from "@/lib/entity";
import { withParams } from "@/lib/href";
import { dateLabel, money } from "@/lib/format";
import { fyBounds, fyMonths } from "@/lib/period";
import {
  getReportingPeriod,
  ledgerAsOfLabel,
  ledgerWrittenTo,
} from "@/lib/reporting-period";
import { buildBudgetVsActualPnl } from "@/lib/reports/budget-pnl";
import { buildEstablishmentDetail } from "@/lib/reports/establishment-detail";
import { buildExpenseDetail } from "@/lib/reports/expense-detail";
import {
  AKSHAYAM_ESTABLISHMENT_SCHEDULE,
  AKSHAYAM_OTHER_EXPENSES_SCHEDULE,
  buildLineItemBudget,
} from "@/lib/reports/line-item-budget";
import {
  buildReimbursementReco,
  hasReimbursementBillLines,
} from "@/lib/reports/reimbursement-reco";
import { buildTeamCost } from "@/lib/reports/team-cost";
import { requireEntityAccess } from "@/lib/auth/dal";

export const dynamic = "force-dynamic";

/**
 * Budget vs Actual.
 *
 * One question: is the year on budget, and where is it not. Everything here is
 * the whole company against the plan it was set - the common-size restatement
 * and the vertical split moved to the P&L page, which is where a statement
 * recut a different way belongs.
 *
 * Under the statement sits the breakdown of Other expenses, because that is
 * the line the founder actually watches, and one figure a month does not
 * answer why it moved.
 */
export default async function BudgetVsActualPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireEntityAccess();
  const params = await searchParams;

  try {
    const entity = await getEntity();
    // A slice (RAJA, or one vertical on its own) has no budgeted P&L of its
    // own, so the statement and the Other-expenses breakdown are held back and
    // a note stands in their place. The Team cost card still shows: its budget
    // is hard-coded per vertical, so it works for any cut of the verticals.
    const isSlice = entity.verticalIds !== null;

    const availableYears = await getAvailableFinancialYears(entity.memberIds);
    if (availableYears.length === 0) {
      return (
        <>
          <PageHeader title="Budget vs Actual" />
          <EmptyState
            title="No ledger data yet"
            href="/upload"
            cta="Upload the general ledger"
          >
            The actual side of every comparison comes from the general ledger.
            Upload it and the budget already loaded for this year fills in
            beside it.
          </EmptyState>
        </>
      );
    }

    // The global reporting period. The budget side snaps to whole months
    // (`periodMonths`); the actual side uses the exact dates (`window`).
    const preview = await getReportingPeriod(entity, availableYears);
    const writtenTo = await ledgerWrittenTo(entity.memberIds, preview.fyStartYear);
    const period = await getReportingPeriod(entity, availableYears, writtenTo);
    const fy = period.fyStartYear;
    const months = fyMonths(fy);

    /**
     * A custom range spanning several months (say 1 Apr - 31 Jul) is not a
     * period this page can hold a budget against the way a quarter or a year
     * can - there is no "four months of budget" the firm plans to. On this
     * tab only, a custom range therefore collapses to its own last month:
     * every "period" figure below - budget and actual alike - reads just
     * that month, while the year-to-date columns beside them still carry
     * the whole year's story.
     */
    const isCustomRange = period.preset === "custom";
    const lastTouchedMonth = period.periodMonths[period.periodMonths.length - 1] ?? null;
    const periodMonths =
      isCustomRange && lastTouchedMonth ? [lastTouchedMonth] : period.periodMonths;
    const periodLabel = isCustomRange && lastTouchedMonth ? lastTouchedMonth.label : period.label;
    const periodColumnLabel =
      isCustomRange && lastTouchedMonth ? lastTouchedMonth.label : period.shortLabel;

    /**
     * Year to date, always - shown beside whatever the picker's own period is,
     * so every breakdown on this tab never loses the full-year story. Stops
     * at the last *completed* month rather than however far the ledger
     * happens to reach mid-month: a GL posted through 15 September has not
     * finished September, so August is still the year to date.
     */
    const ytdCutoff = writtenTo ?? period.end;
    const ytdMonths = months.filter((m) => m.end <= ytdCutoff);
    const ytdThrough = ytdMonths[ytdMonths.length - 1]?.end ?? null;
    const ytdLabel = ytdThrough ? `to ${dateLabel(ytdThrough)}` : "1 Apr onward";

    // What the main statement's actual side needs read from the ledger: from
    // the start of the year through whichever is further out, the picked
    // period or the YTD cutoff - wide enough that summing either periodMonths
    // or ytdMonths afterwards finds real data, not a month never fetched.
    const fetchWindow = {
      start: fyBounds(fy, entity.fy_start_month).start,
      end: period.end > ytdCutoff ? period.end : ytdCutoff,
    };

    const [verticals, statement] = await Promise.all([
      getVerticals(entity),
      isSlice
        ? null
        : buildBudgetVsActualPnl({
            entity,
            fyStartYear: fy,
            window: fetchWindow,
          }),
    ]);

    /**
     * The statement's own Team cost budget, for the period on screen, the
     * year to date, and the whole year. The breakdown card prorates its
     * hard-coded annual budget on the same curve, so the card's totals tie to
     * the "Team cost" line above. A slice has no statement, so the card falls
     * back to an even spread.
     */
    const teamCostLine = statement?.lines.find((l) => l.code === "direct_cost");
    const budgetOver = (ms: typeof months) =>
      ms.reduce((s, m) => s + (teamCostLine?.budget[m.key] ?? 0), 0);

    const [expenseDetail, teamCost, establishment] = await Promise.all([
      isSlice ? null : buildExpenseDetail({ entity, fyStartYear: fy, periodMonths, ytdMonths }),
      buildTeamCost({
        entity,
        fyStartYear: fy,
        periodMonths,
        ytdMonths,
        statementBudget: {
          period: budgetOver(periodMonths),
          ytd: budgetOver(ytdMonths),
          annual: budgetOver(months),
        },
      }),
      isSlice
        ? null
        : buildEstablishmentDetail({
            entity,
            fyStartYear: fy,
            periodMonths,
            ytdMonths,
          }),
    ]);
    const editableMonth = periodMonths.length === 1 ? `${periodMonths[0].key}-01` : null;

    /**
     * Akshayam's own office/overhead schedule and reimbursement position.
     * Akshayam carries no line-by-line Establishment schedule in
     * establishment-detail.ts (RBJV only) and no expense_budget_lines detail
     * at all (its budget sheet has no overhead breakdown block to read one
     * from - see budget.ts), so both cards here are built from "4 - Akshayam
     * Monthly"'s own figures directly rather than the mechanisms RBJV's
     * equivalent cards read.
     */
    const isAkshayam = !isSlice && entity.slug === "akshayam";
    const [akshayamEstablishment, akshayamOtherExpenses, reimbursementReco] = await Promise.all([
      isAkshayam
        ? buildLineItemBudget({
            entity,
            fyStartYear: fy,
            periodMonths,
            ytdMonths,
            schedule: AKSHAYAM_ESTABLISHMENT_SCHEDULE,
          })
        : null,
      isAkshayam
        ? buildLineItemBudget({
            entity,
            fyStartYear: fy,
            periodMonths,
            ytdMonths,
            schedule: AKSHAYAM_OTHER_EXPENSES_SCHEDULE,
          })
        : null,
      isAkshayam && (await hasReimbursementBillLines(entity.memberIds, entity.verticalIds))
        ? buildReimbursementReco({
            entity,
            start: fyBounds(fy, entity.fy_start_month).start,
            end: fyBounds(fy, entity.fy_start_month).end,
            fyStartYear: fy,
          })
        : null,
    ]);

    // Lines the budget carries but the ledger has not yet posted. Depreciation
    // and tax land at audit and drawings may be booked to the balance sheet, so
    // an empty actual is a timing difference, not a saving.
    const notYetPosted = (statement?.lines ?? [])
      .filter(
        (l) =>
          !l.isSubtotal &&
          periodMonths.reduce((s, m) => s + l.budget[m.key], 0) > 0 &&
          Math.abs(periodMonths.reduce((s, m) => s + l.actual[m.key], 0)) < 0.5,
      )
      .map((l) => l.name);

    return (
      <>
        <PageHeader
          title="Budget vs Actual"
          subtitle={`${entity.name} · ${periodLabel}${
            ledgerAsOfLabel(writtenTo) ? ` · ${ledgerAsOfLabel(writtenTo)}` : ""
          }`}
          actions={
            <DownloadExcel
              href={withParams("/api/export", params, {
                kind: "budget-vs-actual",
                vertical: null,
                drill: null,
              })}
            />
          }
        />

        <div className="space-y-4">
          {isSlice && (
            <CompanyOnly
              what="The budgeted P&L"
              slice
              companies={entity.memberIds.length}
            />
          )}

          {!isSlice && statement && !statement.hasBudget && (
            <Notice
              tone="caution"
              title="No budget loaded for this year"
              action={
                <Link
                  href="/upload"
                  className="whitespace-nowrap rounded-md border border-caution/30 px-2.5 py-1.5 text-[12px] font-medium hover:bg-caution/10"
                >
                  Upload budget
                </Link>
              }
            >
              The actual column is live, but there is nothing to compare it
              against. Drop the planning workbook on the Budget tile of the
              upload page and every figure here fills in beside it.
            </Notice>
          )}

          {notYetPosted.length > 0 && (
            <Notice
              tone="info"
              title={`${notYetPosted.join(", ")} not yet in the ledger`}
            >
              Budgeted for the period but nothing posted. Depreciation and tax
              are charged once a year at audit — so the variance on those lines
              is timing, not a saving. EBITDA is unaffected.
            </Notice>
          )}

          {!isSlice && statement && (
            <Card padded={false}>
              <div className="px-4 pt-4 sm:px-5">
                <CardTitle hint={periodLabel}>Budget vs actual</CardTitle>
              </div>
              <BvaStatement
                lines={statement.lines}
                periodMonths={periodMonths}
                ytdMonths={ytdMonths}
                periodLabel={periodColumnLabel}
                ytdLabel={ytdLabel}
              />
            </Card>
          )}

          {teamCost.hasData && (
            <Card padded={false}>
              <div className="px-4 pt-4 sm:px-5">
                <CardTitle hint={periodLabel}>Team cost — budget vs actual</CardTitle>
              </div>
              <TeamCostTable
                result={teamCost}
                periodLabel={periodColumnLabel}
                ytdLabel={ytdLabel}
              />
            </Card>
          )}

          {!isSlice && establishment?.hasData && (
            <Card padded={false}>
              <div className="px-4 pt-4 sm:px-5">
                <CardTitle hint={periodLabel}>Establishment cost — budget vs actual</CardTitle>
              </div>
              <EstablishmentCostTable
                result={establishment}
                periodLabel={periodColumnLabel}
                ytdLabel={ytdLabel}
              />
            </Card>
          )}

          {akshayamEstablishment?.hasData && (
            <Card padded={false}>
              <div className="px-4 pt-4 sm:px-5">
                <CardTitle hint={periodLabel}>Establishment cost — budget vs actual</CardTitle>
              </div>
              <EstablishmentCostTable
                result={akshayamEstablishment}
                periodLabel={periodColumnLabel}
                ytdLabel={ytdLabel}
                caption="Budget is the office schedule from the planning workbook, spread evenly. Actual is the named ledger accounts behind each line — rent and its maintenance combined, per the plan. Open a line for the postings behind it."
              />
            </Card>
          )}

          {akshayamOtherExpenses?.hasData && (
            <Card padded={false}>
              <div className="px-4 pt-4 sm:px-5">
                <CardTitle hint={periodLabel}>Other expenses — budget vs actual</CardTitle>
              </div>
              <EstablishmentCostTable
                result={akshayamOtherExpenses}
                periodLabel={periodColumnLabel}
                ytdLabel={ytdLabel}
                caption="Budget is from the planning workbook, spread evenly. Actual is the named ledger accounts behind each line. Open a line for the postings behind it."
                totalLabel="Other expenses"
              />
              {reimbursementReco && (
                <div className="border-t border-line px-4 py-4 sm:px-5">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-faint">
                    RE / RI Reconciliation
                  </p>
                  <p className="text-[12.5px] text-ink-muted">
                    <span className="font-medium text-caution">
                      {reimbursementReco.totals.reNeedsRiCount} RI still need raising
                    </span>{" "}
                    ({money(reimbursementReco.totals.reNeedsRiAmount)}) ·{" "}
                    <span className="font-medium text-caution">
                      {reimbursementReco.totals.riOnlyCount} RI raised, RE not accounted
                    </span>{" "}
                    ({money(reimbursementReco.totals.riOnlyAmount)}) ·{" "}
                    <span className="font-medium text-positive">
                      {reimbursementReco.totals.matchedCount} matched
                    </span>{" "}
                    ({money(reimbursementReco.totals.matchedAmount)})
                  </p>
                  <Link
                    href="/reimbursements"
                    className="mt-2 inline-block text-[12.5px] font-medium text-navy hover:underline"
                  >
                    View full reconciliation →
                  </Link>
                </div>
              )}
            </Card>
          )}

          {!isSlice && expenseDetail?.hasDetail && (
            <Card padded={false}>
              <div className="px-4 pt-4 sm:px-5">
                <CardTitle
                  hint={
                    editableMonth
                      ? `${periodLabel} · editable`
                      : `${periodLabel} · pick a month to edit`
                  }
                >
                  Other expenses — what it is made of
                </CardTitle>
              </div>
              <ExpenseDetailTable
                lines={expenseDetail.lines}
                fy={fy}
                month={editableMonth}
                vendors={expenseDetail.vendors}
                monthLabel={editableMonth ? periodMonths[0].label : null}
                periodLabel={periodColumnLabel}
                ytdLabel={ytdLabel}
              />
              {Math.abs(
                expenseDetail.statement.period.ledger - expenseDetail.totals.periodActual,
              ) > 0.5 && (
                <div className="px-4 pb-4 sm:px-5">
                  <Notice tone="caution" title="Entries do not agree with the ledger">
                    The ledger posted{" "}
                    <span className="num font-medium">
                      {Math.round(expenseDetail.statement.period.ledger).toLocaleString("en-IN")}
                    </span>{" "}
                    of other expenses for this period; the entries above come to{" "}
                    <span className="num font-medium">
                      {Math.round(expenseDetail.totals.periodActual).toLocaleString("en-IN")}
                    </span>
                    . The statement above stays the ledger&rsquo;s — entries here are the
                    breakdown, and this is the check that the two have not drifted apart.
                  </Notice>
                </div>
              )}
            </Card>
          )}

          {!isSlice && verticals.length > 0 && (
            <Notice tone="info">
              Every figure here is the whole company. The Profit &amp; Loss page
              takes a vertical picker if you want one line of business on its
              own.
            </Notice>
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

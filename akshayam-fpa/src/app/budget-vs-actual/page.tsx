import Link from "next/link";
import { BvaStatement } from "@/components/BvaTable";
import { ExpenseDetailTable } from "@/components/ExpenseDetailTable";
import { BvaControls } from "@/components/BvaControls";
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
import { fyLabel, fyMonths, type QuarterNo } from "@/lib/period";
import { ledgerAsOfLabel, ledgerWrittenTo } from "@/lib/reporting-period";
import { buildBudgetVsActualPnl } from "@/lib/reports/budget-pnl";
import { buildExpenseDetail } from "@/lib/reports/expense-detail";
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
    if (entity.verticalIds) {
      return (
        <>
          <PageHeader title="Budget vs Actual" />
          <CompanyOnly what="The budgeted P&L" slice />
        </>
      );
    }

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

    const requestedFy = Number(params.fy);
    const fy = availableYears.includes(requestedFy)
      ? requestedFy
      : availableYears[0];
    const months = fyMonths(fy);

    const [verticals, statement, writtenTo] = await Promise.all([
      getVerticals(entity),
      buildBudgetVsActualPnl({ entity, fyStartYear: fy }),
      ledgerWrittenTo(entity.memberIds, fy),
    ]);

    /**
     * The period this page compares on: whole months, up to and including the
     * month the ledger has reached. A part month counts in full - a ledger
     * pasted to 24 August carries five months of budget, not four and
     * three-quarters. That is the firm's own convention and the same rule the
     * revenue and collections pages use, so the three pages never disagree
     * about how far the year has run.
     */
    const closed = months.filter((m) => !writtenTo || m.start <= writtenTo);
    const lastClosed = closed[closed.length - 1] ?? months[0];
    const pick = typeof params.period === "string" ? params.period : "ytd";

    let periodMonths = closed.length > 0 ? closed : [months[0]];
    let periodLabel = `Year to date · ${months[0].label} to ${lastClosed.label}`;

    const month = months.find((m) => m.key === pick);
    const quarterPick = /^q([1-4])$/.exec(pick);
    if (month) {
      periodMonths = [month];
      periodLabel = month.label;
    } else if (quarterPick) {
      const q = Number(quarterPick[1]) as QuarterNo;
      periodMonths = months.filter((m) => m.quarter === q);
      periodLabel = `Q${q}`;
    } else if (pick === "full") {
      periodMonths = months;
      periodLabel = `Full year ${fyLabel(fy)}`;
    }

    /**
     * The breakdown behind Other expenses, for the same period as the
     * statement. A correction belongs to the month the cost landed in, so the
     * table is editable only when the period is a single month.
     */
    const expenseDetail = await buildExpenseDetail({
      entity,
      fyStartYear: fy,
      periodMonths,
    });
    const editableMonth = periodMonths.length === 1 ? `${periodMonths[0].key}-01` : null;

    // Lines the budget carries but the ledger has not yet posted. Depreciation
    // and tax land at audit and drawings may be booked to the balance sheet, so
    // an empty actual is a timing difference, not a saving.
    const notYetPosted = statement.lines
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
          subtitle={`${entity.name} · ${fyLabel(fy)} · ${periodLabel}${
            ledgerAsOfLabel(writtenTo) ? ` · ${ledgerAsOfLabel(writtenTo)}` : ""
          }`}
          actions={
            <>
              <BvaControls
                financialYears={availableYears}
                currentFy={fy}
                months={closed.map((m) => ({ value: m.key, label: m.label }))}
                current={pick}
              />
              <DownloadExcel
                href={withParams("/api/export", params, {
                  kind: "budget-vs-actual",
                  fy,
                  vertical: null,
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
          {!statement.hasBudget && (
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
              are charged once a year at audit, and partners&rsquo; drawings may
              be taken against the balance sheet rather than the P&amp;L — so
              the variance on those lines is timing, not a saving. EBITDA is
              unaffected.
            </Notice>
          )}

          <Card padded={false}>
            <div className="px-4 pt-4 sm:px-5">
              <CardTitle hint={periodLabel}>Budget vs actual</CardTitle>
            </div>
            <BvaStatement
              lines={statement.lines}
              months={months}
              periodMonths={periodMonths}
            />
          </Card>

          {expenseDetail.hasDetail && (
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
              />
              {Math.abs(expenseDetail.statement.ledger - expenseDetail.totals.actual) > 0.5 && (
                <div className="px-4 pb-4 sm:px-5">
                  <Notice tone="caution" title="Entries do not agree with the ledger">
                    The ledger posted{" "}
                    <span className="num font-medium">
                      {Math.round(expenseDetail.statement.ledger).toLocaleString("en-IN")}
                    </span>{" "}
                    of other expenses for this period; the entries above come to{" "}
                    <span className="num font-medium">
                      {Math.round(expenseDetail.totals.actual).toLocaleString("en-IN")}
                    </span>
                    . The statement above stays the ledger&rsquo;s — entries here are the
                    breakdown, and this is the check that the two have not drifted apart.
                  </Notice>
                </div>
              )}
            </Card>
          )}

          {verticals.length > 0 && (
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

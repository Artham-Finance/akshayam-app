import { PeriodControls } from "@/components/PeriodControls";
import { SetupRequired } from "@/components/SetupRequired";
import { StatementTable, type ClientLine } from "@/components/StatementTable";
import {
  CompanyOnly,
  EmptyState,
  Notice,
  PageHeader,
  DownloadExcel,
} from "@/components/ui";
import { queryOne } from "@/lib/db";
import {
  getAvailableFinancialYears,
  getEntity,
  getVerticals,
} from "@/lib/entity";
import { withParams } from "@/lib/href";
import { money } from "@/lib/format";
import { fyBounds, fyLabel, fyStartYearOf } from "@/lib/period";
import { buildBalanceSheet } from "@/lib/reports/statements";
import { requireEntityAccess } from "@/lib/auth/dal";

export const dynamic = "force-dynamic";

export default async function BalanceSheetPage({
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
          <PageHeader title="Balance Sheet" />
          <CompanyOnly what="The balance sheet" slice />
        </>
      );
    }
    const [verticals, availableYears] = await Promise.all([
      getVerticals(entity),
      getAvailableFinancialYears(entity.memberIds),
    ]);

    if (availableYears.length === 0) {
      return (
        <>
          <PageHeader title="Balance Sheet" />
          <EmptyState
            title="No ledger data yet"
            href="/upload"
            cta="Upload the general ledger"
          >
            The balance sheet is built from the general ledger plus an opening
            trial balance. Upload both and period-end positions appear here.
          </EmptyState>
        </>
      );
    }

    const requestedFy = Number(params.fy);
    const fy = availableYears.includes(requestedFy)
      ? requestedFy
      : (availableYears[0] ?? fyStartYearOf());

    /**
     * Opening balances only seed the statement when they are dated before the
     * year opens - that is the window buildBalanceSheet reads. Counting every
     * row regardless of date let a trial balance entered with an as-at date
     * inside the year read as loaded while contributing nothing, and the page
     * then blamed the ledger for a gap the date had caused. Count the rows that
     * actually apply, and keep the rest so the difference can be named.
     */
    const { start } = fyBounds(fy, entity.fy_start_month);
    const openingRow = await queryOne<{
      applies: number;
      total: number;
      earliest: string | null;
    }>(
      `select count(*) filter (where as_of < $2)::int as applies,
              count(*)::int                          as total,
              min(as_of) filter (where as_of >= $2)  as earliest
         from opening_balances where entity_id = any($1::int[])`,
      [entity.memberIds, start],
    );
    const openingApplies = openingRow?.applies ?? 0;
    const openingMisdated = (openingRow?.total ?? 0) - openingApplies;

    const statement = await buildBalanceSheet({ entity, fyStartYear: fy });

    const lines: ClientLine[] = statement.lines.map((line) => ({ ...line }));

    // A balance sheet that does not balance is the single most important thing
    // to say out loud, so check the closing month and show the gap plainly.
    const lastMonth = statement.months[statement.months.length - 1].key;
    const assets = lines.find((l) => l.groupCode === "total_assets");
    const equityLiab = lines.find((l) => l.groupCode === "total_eq_liab");
    const gap =
      assets && equityLiab
        ? (assets.values[lastMonth] ?? 0) + (equityLiab.values[lastMonth] ?? 0)
        : 0;
    const balances = Math.abs(gap) < 1;

    return (
      <>
        <PageHeader
          title="Balance Sheet"
          subtitle={`${fyLabel(fy)} · position at each period end · click a quarter heading to open its months`}
          actions={
            <>
              <PeriodControls
                financialYears={availableYears}
                currentFy={fy}
                verticals={verticals.map((v) => ({ id: v.id, name: v.name }))}
                currentVerticalId={null}
                showVerticalPicker={false}
              />
              <DownloadExcel
                href={withParams("/api/export", params, {
                  kind: "balance-sheet",
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
          {openingApplies === 0 && openingMisdated === 0 && (
            <Notice
              tone="caution"
              title="No opening balances loaded"
              action={
                <a
                  href="/upload"
                  className="whitespace-nowrap rounded-md border border-caution/30 px-2.5 py-1.5 text-[12px] font-medium hover:bg-caution/10"
                >
                  Upload trial balance
                </a>
              }
            >
              The balance sheet currently reflects only movements posted this
              year, so it will not tie. Upload the previous year&rsquo;s closing
              trial balance to set the opening position.
            </Notice>
          )}

          {statement.hasUnmapped && (
            <Notice
              tone="caution"
              title={`${money(statement.unmappedTotal)} is shown under Unclassified`}
              action={
                <a
                  href="/settings/accounts"
                  className="whitespace-nowrap rounded-md border border-caution/30 px-2.5 py-1.5 text-[12px] font-medium hover:bg-caution/10"
                >
                  Assign accounts
                </a>
              }
            >
              These accounts have no reporting line yet, so they sit on their
              own line near the foot of the statement rather than in a group.
              They <span className="font-medium">are</span> included in the
              totals — assigning them moves them to where they belong.
            </Notice>
          )}

          {openingApplies === 0 && openingMisdated > 0 && (
            <Notice
              tone="caution"
              title="The opening balances are dated inside this year"
              action={
                <a
                  href="/upload"
                  className="whitespace-nowrap rounded-md border border-caution/30 px-2.5 py-1.5 text-[12px] font-medium hover:bg-caution/10"
                >
                  Re-upload trial balance
                </a>
              }
            >
              A trial balance seeds this statement only when it is dated before{" "}
              {start}, the day {fyLabel(fy)} opens. The rows loaded are dated{" "}
              {openingRow?.earliest} or later, so none of them apply and the
              statement shows this year&rsquo;s movements alone. Upload the
              previous year&rsquo;s closing trial balance with its own as-at
              date.
            </Notice>
          )}

          {openingApplies > 0 && !balances && !statement.hasUnmapped && (
            <Notice tone="negative" title="Balance sheet does not tie">
              Assets and equity + liabilities differ by{" "}
              {Math.abs(gap).toLocaleString("en-IN", {
                maximumFractionDigits: 0,
              })}{" "}
              at {lastMonth}. The opening balances and the ledger disagree —
              usually the general ledger covers a shorter period than the
              opening trial balance, or one of the two files is itself out of
              balance.
            </Notice>
          )}

          {statement.eliminations && statement.eliminations.removed > 0 && (
            <Notice
              tone={statement.eliminations.difference > 1 ? "caution" : "info"}
              title="Intercompany balances eliminated"
            >
              {money(statement.eliminations.removed)} of balances between the
              two companies has been removed, so the group is not shown as owing
              money to itself.
              {statement.eliminations.difference > 1 ? (
                <>
                  {" "}
                  The two sets of books disagree by{" "}
                  <span className="font-semibold">
                    {money(statement.eliminations.difference)}
                  </span>
                  , which is carried as{" "}
                  <span className="font-medium">
                    Unreconciled intercompany difference
                  </span>{" "}
                  rather than forced into reserves. It needs reconciling between
                  the two ledgers.
                </>
              ) : (
                " Both sides agree, so nothing is left over."
              )}
            </Notice>
          )}

          <Notice tone="info">
            A balance sheet is a company-level statement. Verticals are shown on
            the Profit &amp; Loss, where the client&rsquo;s reporting tags make
            a meaningful split possible.
          </Notice>

          <StatementTable
            months={statement.months}
            lines={lines}
            emphasise={["total_assets", "total_eq_liab"]}
            aggregate="closing"
          />
        </div>
      </>
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not reach the database.";
    return <SetupRequired message={message} />;
  }
}

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
import { getAvailableFinancialYears, getEntity } from "@/lib/entity";
import { withParams } from "@/lib/href";
import { money } from "@/lib/format";
import { fyLabel, fyStartYearOf } from "@/lib/period";
import { buildCashFlow } from "@/lib/reports/statements";
import { requireEntityAccess } from "@/lib/auth/dal";

export const dynamic = "force-dynamic";

/**
 * Cash Flow, indirect method.
 *
 * Built from the same ledger as the other two statements and reconciled
 * against the bank accounts independently, so the page can say whether it ties
 * rather than leaving the reader to add it up. Partners' drawings appear under
 * financing, which is where the money actually leaves.
 */
export default async function CashFlowPage({
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
          <PageHeader title="Cash Flow" />
          <CompanyOnly what="The cash flow" slice />
        </>
      );
    }
    const [availableYears, openingRow] = await Promise.all([
      getAvailableFinancialYears(entity.memberIds),
      queryOne<{ count: number }>(
        "select count(*)::int as count from opening_balances where entity_id = any($1::int[])",
        [entity.memberIds],
      ),
    ]);

    if (availableYears.length === 0) {
      return (
        <>
          <PageHeader title="Cash Flow" />
          <EmptyState
            title="No ledger data yet"
            href="/upload"
            cta="Upload the general ledger"
          >
            The cash flow is derived from the general ledger, with the opening
            trial balance supplying the cash position the year started from.
            Upload both and it appears here.
          </EmptyState>
        </>
      );
    }

    const requestedFy = Number(params.fy);
    const fy = availableYears.includes(requestedFy)
      ? requestedFy
      : (availableYears[0] ?? fyStartYearOf());

    const statement = await buildCashFlow({ entity, fyStartYear: fy });
    const lines: ClientLine[] = statement.lines.map((line) => ({ ...line }));

    return (
      <>
        <PageHeader
          title="Cash Flow"
          subtitle={`${fyLabel(fy)} · indirect method · click a quarter heading to open its months`}
          actions={
            <>
              <PeriodControls
                financialYears={availableYears}
                currentFy={fy}
                verticals={[]}
                currentVerticalId={null}
                showVerticalPicker={false}
              />
              <DownloadExcel
                href={withParams("/api/export", params, {
                  kind: "cash-flow",
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
          {(openingRow?.count ?? 0) === 0 && (
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
              The movement in cash is right, but the year is shown as opening
              from nil. Upload the previous year&rsquo;s closing trial balance
              to set the opening cash position.
            </Notice>
          )}

          {statement.hasUnmapped && (
            <Notice
              tone="caution"
              title="Some movements are not categorised"
              action={
                <a
                  href="/settings/accounts"
                  className="whitespace-nowrap rounded-md border border-caution/30 px-2.5 py-1.5 text-[12px] font-medium hover:bg-caution/10"
                >
                  Assign accounts
                </a>
              }
            >
              They appear on their own line rather than being folded into
              working capital, where a wrong guess would be invisible. They{" "}
              <span className="font-medium">are</span> included in the net
              movement.
            </Notice>
          )}

          {!statement.reconciles && (
            <Notice tone="negative" title="Cash flow does not reconcile">
              The statement arrives at a movement{" "}
              {money(Math.abs(statement.gap))} away from what the bank accounts
              actually show. The two are worked out independently, so a gap
              means an account is missing from the ledger rather than
              misclassified.
            </Notice>
          )}

          {entity.isGroup && (
            <Notice
              tone="info"
              title="Intercompany movements are not eliminated here"
            >
              The balance sheet eliminates intercompany balances, but the cash
              that went with them is still in the group&rsquo;s banks, so their
              movements stay in. Money genuinely moving between the two
              companies nets to nothing and disappears from{" "}
              <span className="font-medium">Intercompany, not eliminated</span>{" "}
              by itself — what is left on that line is the amount the two
              ledgers disagree by.
            </Notice>
          )}

          <Notice tone="info">
            Every line is a movement on the ledger, so the sections add back to
            the change in the bank balance without a balancing figure.
            Partners&rsquo; drawings sit under financing; interest is inside
            profit before tax, matching the P&amp;L.
          </Notice>

          <StatementTable
            months={statement.months}
            lines={lines}
            emphasise={["cfo", "net_change", "closing_cash"]}
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

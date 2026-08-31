import Link from "next/link";
import { SetupRequired } from "@/components/SetupRequired";
import { Card, CardTitle, EmptyState, KpiTile, Notice, PageHeader } from "@/components/ui";
import { queryOne } from "@/lib/db";
import {
  countUnmappedAccounts,
  getAvailableFinancialYears,
  getEntity,
  verticalScope,
} from "@/lib/entity";
import { compactINR, dateLabel, percent, share } from "@/lib/format";
import { fyLabel } from "@/lib/period";
import { ledgerAsOfLabel, ledgerWrittenTo, resolvePeriod } from "@/lib/reporting-period";
import { buildBudgetVsActual } from "@/lib/reports/budget";
import { buildProfitAndLoss } from "@/lib/reports/statements";
import { requireEntityAccess } from "@/lib/auth/dal";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  await requireEntityAccess();
  try {
    const entity = await getEntity();
    const [availableYears, unmapped, uploadCount] = await Promise.all([
      getAvailableFinancialYears(entity.memberIds),
      countUnmappedAccounts(entity.memberIds),
      queryOne<{ count: number }>(
        "select count(*)::int as count from uploads where entity_id = any($1::int[]) and status = 'committed'",
        [entity.memberIds],
      ),
    ]);

    if ((uploadCount?.count ?? 0) === 0) {
      return (
        <>
          <PageHeader title="Overview" subtitle={entity.name} />
          <EmptyState title="Nothing uploaded yet" href="/upload" cta="Upload your first report">
            Start with the general ledger for the current financial year. That single file
            produces the profit &amp; loss, balance sheet and cash flow. The revenue,
            collections and receivables views come from the three Zoho sales reports.
          </EmptyState>
        </>
      );
    }

    const fy = availableYears[0] ?? new Date().getFullYear();
    // The same year-to-date the reporting pages use - to the last completed
    // week, not the last day of the year. An overview that disagreed with the
    // page it links to would be the first thing anyone noticed.
    const writtenTo = await ledgerWrittenTo(entity.memberIds, fy);
    const period = resolvePeriod({
      fyStartYear: fy,
      latest: writtenTo,
      params: {},
    });
    const { start, end } = period;

    const [statement, arSnapshot, topTen, revenueBudget, collectionBudget] =
      await Promise.all([
      availableYears.length
        ? buildProfitAndLoss({ entity, fyStartYear: fy, detail: false })
        : null,
      // Each company at its own most recent snapshot. Pinning both to the
      // latest date across the group would drop whichever company's AR export
      // was pulled a day earlier - which is how consolidated receivables came
      // out as one company's book.
      queryOne<{ as_of: string; total: number; overdue_180: number }>(
        `select max(as_of)::text as as_of,
                sum(balance_base)::numeric as total,
                -- The same age the Receivables page measures: from the due date,
                -- falling back to the invoice date. Requiring a due date instead
                -- silently dropped every invoice billed due on receipt, which is
                -- most of them, and the two pages then disagreed about the same
                -- figure.
                sum(case when as_of - coalesce(due_date, invoice_date) > 180
                         then balance_base else 0 end)::numeric as overdue_180
           from ar_open_items
          where (entity_id, as_of) in (
                  select entity_id, max(as_of) from ar_open_items
                   where entity_id = any($1::int[]) group by entity_id)
            ${verticalScope("$2")}
         having count(*) > 0`,
        [entity.memberIds, entity.verticalIds],
      ),
      /**
       * What the ten largest customers come to. The overview says how
       * concentrated the book is; the names are one click away on Receivables.
       */
      queryOne<{ v: number; n: number }>(
        `select coalesce(sum(t.total),0)::numeric v, count(*)::int n from (
                  select coalesce(sum(balance_base),0)::numeric total
                    from ar_open_items
                   where (entity_id, as_of) in (
                           select entity_id, max(as_of) from ar_open_items
                            where entity_id = any($1::int[]) group by entity_id)
                     ${verticalScope("$2")}
                   group by customer_name
                   order by total desc limit 10) t`,
        [entity.memberIds, entity.verticalIds],
      ),
      /**
       * Budget against actual, from the same builder the Revenue and
       * Collections pages use. Percentage achievement is measured against the
       * period budget - the annual figure is context, not a target for five
       * months of the year.
       */
      buildBudgetVsActual({
        entity,
        fyStartYear: fy,
        measure: "revenue",
        period: { start, end, fraction: period.fraction, monthAligned: period.monthAligned },
      }),
      buildBudgetVsActual({
        entity,
        fyStartYear: fy,
        measure: "collection",
        period: { start, end, fraction: period.fraction, monthAligned: period.monthAligned },
      }),
    ]);

    const totalOf = (groupCode: string) => {
      if (!statement) return null;
      const line = statement.lines.find((l) => l.groupCode === groupCode && l.level === 0);
      if (!line) return null;
      return statement.months.reduce((sum, m) => sum + (line.values[m.key] ?? 0), 0);
    };

    const revenue = totalOf("revenue");
    const ebitda = totalOf("ebitda");
    const pat = totalOf("pat");

    const arTotal = arSnapshot ? Number(arSnapshot.total) : null;
    const topTenValue = topTen ? Number(topTen.v) : null;

    /** How a percentage reads: on target, nearly, or not. */
    const achievementTone = (pct: number | null) =>
      pct === null ? ("ink" as const) : pct >= 100 ? ("positive" as const) : pct >= 85 ? ("ink" as const) : ("caution" as const);

    interface Tile {
      label: string;
      value: string | null;
      note: string;
      href: string;
      tone?: "ink" | "positive" | "caution" | "negative";
    }

    /**
     * Four questions, in the order they are asked: what did we bill, what came
     * in, what is still owed, and what was left. Each row is one subject, so a
     * partner reading down the page is never comparing a budget against an
     * ageing bucket because they happened to land side by side.
     */
    const rows: { title: string; hint: string; tiles: Tile[] }[] = [
      {
        title: "Revenue",
        hint: `${period.shortLabel} · ${period.basis}`,
        tiles: [
          {
            label: "Annual budget",
            value: compactINR(revenueBudget.total.annual),
            note: fyLabel(fy),
            href: "/revenue",
          },
          {
            label: "Actual",
            value: compactINR(revenueBudget.total.period.actual),
            note: "Ledger revenue, net of credit notes",
            href: "/revenue",
            tone: "positive",
          },
          {
            label: "% achievement",
            value:
              revenueBudget.total.period.achievement === null
                ? "—"
                : percent(revenueBudget.total.period.achievement, 2),
            note: `Against ${compactINR(revenueBudget.total.period.periodBudget)} period budget`,
            href: "/revenue",
            tone: achievementTone(revenueBudget.total.period.achievement),
          },
        ],
      },
      {
        title: "Collections",
        hint: `${period.shortLabel} · ${period.basis}`,
        tiles: [
          {
            label: "Annual budget",
            value: compactINR(collectionBudget.total.annual),
            note: fyLabel(fy),
            href: "/collections",
          },
          {
            label: "Actual",
            // Fee receipts, not every receipt: this is the figure the
            // percentage beside it is struck on, and a tile showing 2.81 Cr
            // above a percentage computed on 2.59 Cr invites exactly one
            // question and answers none of it. Reimbursement recoveries are a
            // recharge of client-paid costs and are not collection performance.
            value: compactINR(collectionBudget.total.period.actual),
            note: `Fee receipts ${period.label.replace("Year to date · ", "")}`,
            href: "/collections",
            tone: "positive",
          },
          {
            label: "% achievement",
            value:
              collectionBudget.total.period.achievement === null
                ? "—"
                : percent(collectionBudget.total.period.achievement, 2),
            note: `Against ${compactINR(collectionBudget.total.period.periodBudget)} period budget`,
            href: "/collections",
            tone: achievementTone(collectionBudget.total.period.achievement),
          },
        ],
      },
      {
        title: "Receivables",
        hint: arSnapshot ? `as at ${dateLabel(arSnapshot.as_of)}` : "no snapshot uploaded",
        tiles: [
          {
            label: "Outstanding",
            value: arTotal === null ? null : compactINR(arTotal),
            note: arSnapshot ? `As at ${dateLabel(arSnapshot.as_of)}` : "No snapshot uploaded",
            href: "/receivables",
          },
          {
            label: "Overdue exceeding 180 days",
            value: arSnapshot ? compactINR(Number(arSnapshot.overdue_180)) : null,
            note: arSnapshot
              ? `${percent(share(Number(arSnapshot.overdue_180), arTotal ?? 0))} of receivables`
              : "No snapshot uploaded",
            href: "/receivables?drill=over180",
            tone: "caution",
          },
          {
            label: `Top ${topTen?.n ?? 10} customers`,
            value: topTenValue === null ? null : compactINR(topTenValue),
            note:
              topTenValue === null || !arTotal
                ? "No snapshot uploaded"
                : `${percent(share(topTenValue, arTotal))} of the book`,
            href: "/receivables?drill=top10",
          },
        ],
      },
      {
        title: "Profitability",
        hint: `${period.shortLabel} · from the ledger`,
        tiles: [
          {
            label: "EBITDA",
            value: ebitda === null ? null : compactINR(ebitda),
            note:
              revenue && ebitda !== null
                ? `${percent(share(ebitda, revenue))} of revenue`
                : "Year to date",
            href: "/pnl",
          },
          {
            label: "Profit after tax",
            value: pat === null ? null : compactINR(pat),
            note:
              revenue && pat !== null ? `${percent(share(pat, revenue))} of revenue` : "Year to date",
            href: "/pnl",
          },
        ],
      },
    ];

    return (
      <>
        <PageHeader
          title="Overview"
          subtitle={`${entity.name} · ${fyLabel(fy)}${
            ledgerAsOfLabel(writtenTo) ? ` · ${ledgerAsOfLabel(writtenTo)}` : ""
          }`}
        />

        <div className="space-y-4">
          {unmapped > 0 && (
            <Notice
              tone="caution"
              title={`${unmapped} ledger account${unmapped === 1 ? "" : "s"} classified automatically`}
              action={
                <Link
                  href="/settings/accounts"
                  className="whitespace-nowrap rounded-md border border-caution/30 px-2.5 py-1.5 text-[12px] font-medium hover:bg-caution/10"
                >
                  Review
                </Link>
              }
            >
              Their reporting line was guessed from the account name rather than confirmed. The
              amounts are included in the figures below.
            </Notice>
          )}

          {rows.map((row) => (
            <section key={row.title}>
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <h2 className="text-[13px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
                  {row.title}
                </h2>
                <span className="text-[11px] text-ink-faint">{row.hint}</span>
              </div>
              <div
                className={
                  row.tiles.length === 2
                    ? "grid grid-cols-1 gap-3 sm:grid-cols-2"
                    : "grid grid-cols-1 gap-3 sm:grid-cols-3"
                }
              >
                {row.tiles.map((tile) => (
                  <KpiTile
                    key={tile.label}
                    label={tile.label}
                    value={tile.value ?? "—"}
                    note={tile.note}
                    tone={tile.tone ?? "ink"}
                    href={tile.href}
                  />
                ))}
              </div>
            </section>
          ))}

          <Card>
            <CardTitle hint="the three statements are live">Where to go next</CardTitle>
            <ul className="space-y-2 text-[13px] text-ink-muted">
              <li>
                <Link href="/pnl" className="font-medium text-navy hover:underline">
                  Profit &amp; Loss
                </Link>{" "}
                — monthly and quarterly, with a vertical picker.
              </li>
              <li>
                <Link href="/balance-sheet" className="font-medium text-navy hover:underline">
                  Balance Sheet
                </Link>{" "}
                — period-end position for each month and quarter.
              </li>
              <li>
                <Link href="/upload" className="font-medium text-navy hover:underline">
                  Upload
                </Link>{" "}
                — refresh any report by dropping in a new Zoho export.
              </li>
            </ul>
          </Card>
        </div>
      </>
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not reach the database.";
    return <SetupRequired message={message} />;
  }
}

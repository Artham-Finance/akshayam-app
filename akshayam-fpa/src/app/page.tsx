import Link from "next/link";
import { SetupRequired } from "@/components/SetupRequired";
import { Card, CardTitle, EmptyState, KpiTile, Notice, PageHeader } from "@/components/ui";
import { query, queryOne } from "@/lib/db";
import {
  countUnmappedAccounts,
  getAvailableFinancialYears,
  getEntity,
  verticalScope,
} from "@/lib/entity";
import { compactINR, dateLabel, percent, share } from "@/lib/format";
import { fyLabel } from "@/lib/period";
import { ledgerWrittenTo, resolvePeriod } from "@/lib/reporting-period";
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
    const period = resolvePeriod({
      fyStartYear: fy,
      latest: await ledgerWrittenTo(entity.memberIds, fy),
      params: {},
    });
    const { start, end } = period;

    const [statement, arSnapshot, collections] = await Promise.all([
      availableYears.length
        ? buildProfitAndLoss({ entity, fyStartYear: fy, detail: false })
        : null,
      // Each company at its own most recent snapshot. Pinning both to the
      // latest date across the group would drop whichever company's AR export
      // was pulled a day earlier - which is how consolidated receivables came
      // out as one company's book.
      queryOne<{ as_of: string; total: number; overdue_90: number }>(
        `select max(as_of)::text as as_of,
                sum(balance_base)::numeric as total,
                sum(case when due_date is not null and as_of - due_date > 90
                         then balance_base else 0 end)::numeric as overdue_90
           from ar_open_items
          where (entity_id, as_of) in (
                  select entity_id, max(as_of) from ar_open_items
                   where entity_id = any($1::int[]) group by entity_id)
            ${verticalScope("$2")}
         having count(*) > 0`,
        [entity.memberIds, entity.verticalIds],
      ),
      queryOne<{ total: number }>(
        `select coalesce(sum(a.amount_base), 0)::numeric as total
           from payment_allocations a
           join payments p on p.id = a.payment_id
          where a.entity_id = any($1::int[]) and p.payment_date between $2 and $3
            ${verticalScope("$4", "a.vertical_id")}`,
        [entity.memberIds, start, end, entity.verticalIds],
      ),
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

    const tiles: {
      label: string;
      value: string | null;
      note: string;
      href: string;
      tone?: "ink" | "positive" | "caution" | "negative";
    }[] = [
      {
        label: `Revenue ${fyLabel(fy)}`,
        value: revenue === null ? null : compactINR(revenue),
        note: "Year to date, from the ledger",
        href: "/pnl",
      },
      {
        label: "EBITDA",
        value: ebitda === null ? null : compactINR(ebitda),
        note:
          revenue && ebitda !== null ? `${percent(share(ebitda, revenue))} of revenue` : "Year to date",
        href: "/pnl",
      },
      {
        label: "Profit after tax",
        value: pat === null ? null : compactINR(pat),
        note: revenue && pat !== null ? `${percent(share(pat, revenue))} of revenue` : "Year to date",
        href: "/pnl",
      },
      {
        label: "Collections",
        value: collections ? compactINR(Number(collections.total)) : null,
        note: `Received ${period.label.replace("Year to date · ", "")}`,
        href: "/collections",
      },
      {
        label: "Receivables",
        value: arSnapshot ? compactINR(Number(arSnapshot.total)) : null,
        note: arSnapshot ? `As at ${dateLabel(arSnapshot.as_of)}` : "No snapshot uploaded",
        href: "/receivables",
      },
      {
        label: "Overdue over 90 days",
        value: arSnapshot ? compactINR(Number(arSnapshot.overdue_90)) : null,
        note: arSnapshot
          ? `${percent(share(Number(arSnapshot.overdue_90), Number(arSnapshot.total)))} of receivables`
          : "No snapshot uploaded",
        href: "/receivables",
        tone: "caution" as const,
      },
    ];

    return (
      <>
        <PageHeader
          title="Overview"
          subtitle={`${entity.name} · ${fyLabel(fy)}`}
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

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            {tiles.map((tile) => (
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

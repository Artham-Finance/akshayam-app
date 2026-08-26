import { Bar, DataTable, drillColumns, renderDrillRow } from "@/components/DataTable";
import { PeriodControls } from "@/components/PeriodControls";
import { SetupRequired } from "@/components/SetupRequired";
import {
  Card,
  CardTitle,
  DrillPanel,
  EmptyState,
  KpiTile,
  Notice,
  PageHeader,
} from "@/components/ui";
import { query, queryOne } from "@/lib/db";
import { getEntity, getVerticals, verticalScope } from "@/lib/entity";
import { compactINR, dateLabel, money, percent, share } from "@/lib/format";
import { withParams } from "@/lib/href";
import { isDrill, runDrill } from "@/lib/reports/drilldowns";
import { requireEntityAccess } from "@/lib/auth/dal";

export const dynamic = "force-dynamic";

/** A drill-down is for reading, not for exporting: past a few hundred rows it stops helping. */
const DRILL_LIMIT = 250;

/**
 * Receivables.
 *
 * Age is measured from the due date, falling back to the invoice date when a
 * due date is missing - measuring from the invoice date throughout would make
 * everything look older than it is and overstate the overdue tail.
 */
const ageExpr = (t = "") => `(${t}as_of - coalesce(${t}due_date, ${t}invoice_date))`;
const AGE_EXPR = ageExpr();

const BUCKETS = [
  { key: "current", label: "Not yet due", test: `${AGE_EXPR} <= 0`, tone: "bg-positive" },
  { key: "d30", label: "1 - 30 days", test: `${AGE_EXPR} between 1 and 30`, tone: "bg-navy" },
  { key: "d90", label: "31 - 90 days", test: `${AGE_EXPR} between 31 and 90`, tone: "bg-series-2" },
  { key: "d180", label: "91 - 180 days", test: `${AGE_EXPR} between 91 and 180`, tone: "bg-caution" },
  { key: "d181", label: "Over 180 days", test: `${AGE_EXPR} > 180`, tone: "bg-negative" },
] as const;

const bucketSelect = BUCKETS.map(
  (b) => `coalesce(sum(case when ${b.test} then balance_base else 0 end),0)::numeric as ${b.key}`,
).join(",\n            ");

/**
 * Each company's own most recent snapshot, which need not be the same date.
 *
 * Consolidated receivables are two AR exports pulled on whatever days they were
 * pulled. Pinning both to a single date would silently drop a company whose
 * export was taken a day earlier, so each is taken at its own latest.
 * `$1` is the list of entity ids.
 */
const LATEST_SNAPSHOT = `(entity_id, as_of) in (
             select entity_id, max(as_of) from ar_open_items
              where entity_id = any($1::int[]) group by entity_id)`;

export default async function ReceivablesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireEntityAccess();
  const params = await searchParams;

  try {
    const entity = await getEntity();
    const verticals = await getVerticals(entity);

    const snapshots = await query<{ name: string; as_of: string }>(
      `select e.name, max(a.as_of)::text as as_of
         from ar_open_items a join entities e on e.id = a.entity_id
        where a.entity_id = any($1::int[])
          ${verticalScope("$2", "a.vertical_id")}
        group by e.name order by 2 desc`,
      [entity.memberIds, entity.verticalIds],
    );

    if (snapshots.length === 0) {
      return (
        <>
          <PageHeader title="Receivables" />
          <EmptyState title="No receivables snapshot" href="/upload" cta="Upload AR Aging">
            Receivables come from the Zoho AR Aging export. Each upload is a dated snapshot,
            so the ageing trend builds up as you load them week by week.
          </EmptyState>
        </>
      );
    }

    const asOf = snapshots[0].as_of;
    const mixedDates = new Set(snapshots.map((s) => s.as_of)).size > 1;
    const requestedVertical = Number(params.vertical);
    const verticalId = verticals.some((v) => v.id === requestedVertical) ? requestedVertical : null;
    const verticalName = verticals.find((v) => v.id === verticalId)?.name ?? null;

    const scope = [entity.memberIds, verticalId, entity.verticalIds];

    const [totals, byVertical, byClient, worstInvoices, unmatched, terms] = await Promise.all([
      queryOne<Record<string, number>>(
        `select ${bucketSelect},
                coalesce(sum(balance_base),0)::numeric total, count(*)::int n
           from ar_open_items
          where ${LATEST_SNAPSHOT} and ($2::int is null or vertical_id=$2)
            ${verticalScope("$3")}`,
        scope,
      ),
      query<Record<string, string | number | null>>(
        `select v.code, v.name, ${bucketSelect},
                coalesce(sum(a.balance_base),0)::numeric total
           from ar_open_items a left join verticals v on v.id=a.vertical_id
          where (a.entity_id, a.as_of) in (
                  select entity_id, max(as_of) from ar_open_items
                   where entity_id = any($1::int[]) group by entity_id)
            ${verticalScope("$2", "a.vertical_id")}
          group by v.code, v.name order by 8 desc`,
        [entity.memberIds, entity.verticalIds],
      ),
      query<Record<string, string | number>>(
        `select customer_name, ${bucketSelect},
                coalesce(sum(balance_base),0)::numeric total,
                coalesce(sum(case when ${AGE_EXPR} > 90 then balance_base else 0 end),0)::numeric over90
           from ar_open_items
          where ${LATEST_SNAPSHOT} and ($2::int is null or vertical_id=$2)
            ${verticalScope("$3")}
          group by customer_name order by 7 desc limit 12`,
        scope,
      ),
      query<{
        invoice_number: string | null; customer_name: string; salesperson: string | null;
        invoice_date: string | null; due_date: string | null; age: number; balance_base: number;
      }>(
        `select invoice_number, customer_name, salesperson, invoice_date::text, due_date::text,
                ${AGE_EXPR}::int as age, balance_base
           from ar_open_items
          where ${LATEST_SNAPSHOT} and ($2::int is null or vertical_id=$2)
            ${verticalScope("$3")}
            and ${AGE_EXPR} > 90
          order by balance_base desc limit 20`,
        scope,
      ),
      queryOne<{ n: number; v: number }>(
        `select count(*)::int n, coalesce(sum(balance_base),0)::numeric v
           from ar_open_items where ${LATEST_SNAPSHOT} and vertical_id is null
             ${verticalScope("$2")}`,
        [entity.memberIds, entity.verticalIds],
      ),
      queryOne<{ with_terms: number; total: number }>(
        `select count(*) filter (where due_date > invoice_date)::int with_terms,
                count(*)::int total
           from ar_open_items where ${LATEST_SNAPSHOT}
             ${verticalScope("$2")}`,
        [entity.memberIds, entity.verticalIds],
      ),
    ]);

    // The invoices behind a tile, from the same definition the Excel export uses.
    const drill = typeof params.drill === "string" ? params.drill : null;
    const chosen = isDrill("receivables", drill)
      ? await runDrill({
          kind: "receivables",
          drill,
          entity,
          // Receivables are a snapshot, so the period bounds go unused - the
          // drill takes each company's latest AR export.
          start: asOf,
          end: asOf,
          verticalId,
          limit: DRILL_LIMIT,
        })
      : null;

    const total = Number(totals?.total ?? 0);
    const over90 = Number(totals?.d180 ?? 0) + Number(totals?.d181 ?? 0);
    const peakBucket = Math.max(1, ...BUCKETS.map((b) => Number(totals?.[b.key] ?? 0)));

    return (
      <>
        <PageHeader
          title="Receivables"
          subtitle={`As at ${dateLabel(asOf)}${verticalName ? ` · ${verticalName}` : ""} · age measured from the due date`}
          actions={
            <PeriodControls
              financialYears={[]}
              currentFy={0}
              verticals={verticals.map((v) => ({ id: v.id, name: v.name }))}
              currentVerticalId={verticalId}
            />
          }
        />

        <div className="space-y-4">
          {mixedDates && (
            <Notice tone="info" title="The two snapshots were taken on different days">
              Each company is shown at its own most recent AR export
              {" — "}
              {snapshots.map((s) => `${s.name} at ${dateLabel(s.as_of)}`).join(", ")}. Re-export
              both on the same day for a strictly comparable group position.
            </Notice>
          )}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {(
              [
                { key: "total", label: "Total outstanding", value: total, note: `${totals?.n ?? 0} open invoices`, tone: "ink" },
                { key: "current", label: "Not yet due", value: Number(totals?.current ?? 0), note: `${percent(share(Number(totals?.current ?? 0), total))} of book`, tone: "positive" },
                { key: "over90", label: "Overdue over 90 days", value: over90, note: `${percent(share(over90, total))} of book`, tone: "caution" },
                { key: "over180", label: "Overdue over 180 days", value: Number(totals?.d181 ?? 0), note: "Collection risk", tone: "negative" },
              ] as const
            ).map((t) => (
              <KpiTile
                key={t.key}
                label={t.label}
                value={compactINR(t.value)}
                note={t.note}
                tone={t.tone}
                active={drill === t.key}
                href={withParams("/receivables", params, {
                  drill: drill === t.key ? null : t.key,
                })}
              />
            ))}
          </div>

          {chosen && (
            <DrillPanel
              title={chosen.title}
              subtitle={
                <>
                  As at {dateLabel(asOf)}
                  {verticalName ? ` · ${verticalName}` : ""} · age measured from the due date,
                  largest balance first
                </>
              }
              closeHref={withParams("/receivables", params, { drill: null })}
              downloadHref={withParams("/api/export", params, {
                kind: "receivables",
                vertical: verticalId,
              })}
              shown={chosen.rows.length}
              total={chosen.total}
            >
              <DataTable
                columns={drillColumns(chosen.columns)}
                rows={chosen.rows.map((r) => renderDrillRow(r, chosen.columns))}
                emptyMessage="No open invoices in this bucket."
              />
            </DrillPanel>
          )}

          {(terms?.with_terms ?? 0) === 0 && (terms?.total ?? 0) > 0 && (
            <Notice tone="info" title="Invoices are billed due on receipt">
              Every open invoice carries a due date equal to its invoice date, so no credit
              period is recorded in Zoho. &ldquo;Overdue&rdquo; below therefore means
              <span className="font-medium"> unpaid since it was raised</span>, not past an
              agreed payment term &mdash; which is why almost nothing sits in
              &ldquo;not yet due&rdquo;. If the firm does allow a credit period, setting the
              payment terms in Zoho will make this ageing reflect it.
            </Notice>
          )}

          {(unmatched?.n ?? 0) > 0 && (
            <Notice tone="info" title={`${compactINR(Number(unmatched?.v ?? 0))} without a vertical`}>
              {unmatched?.n} open item(s) have no salesperson on the AR report, so they cannot be
              attributed to a vertical. They are included in the totals above.
            </Notice>
          )}

          <Card>
            <CardTitle hint={`${compactINR(total)} outstanding`}>Ageing</CardTitle>
            <div className="space-y-2">
              {BUCKETS.map((b) => {
                const value = Number(totals?.[b.key] ?? 0);
                return (
                  <div key={b.key} className="flex items-center gap-3">
                    <span className="w-28 shrink-0 text-[12px] text-ink-muted">{b.label}</span>
                    <Bar
                      max={peakBucket}
                      segments={[{ value, className: b.tone, label: `${b.label} ${money(value)}` }]}
                    />
                    <span className="num w-28 shrink-0 text-right text-[12.5px] font-medium text-ink">
                      {value ? money(value) : "—"}
                    </span>
                    <span className="num w-14 shrink-0 text-right text-[11.5px] text-ink-faint">
                      {percent(share(value, total))}
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card padded={false}>
            <div className="p-4 sm:p-5">
              <CardTitle>By vertical</CardTitle>
            </div>
            <DataTable
              columns={[
                { header: "Vertical" },
                ...BUCKETS.map((b) => ({ header: b.label, numeric: true })),
                { header: "Total", numeric: true, strong: true },
              ]}
              rows={byVertical.map((r) => [
                (r.code as string) ?? "Unallocated",
                ...BUCKETS.map((b) => (Number(r[b.key]) ? money(Number(r[b.key])) : "—")),
                money(Number(r.total)),
              ])}
            />
          </Card>

          <Card padded={false}>
            <div className="p-4 sm:p-5">
              <CardTitle hint="ranked by total outstanding">Clients driving the balance</CardTitle>
            </div>
            <DataTable
              columns={[
                { header: "Client" },
                { header: "Not yet due", numeric: true },
                { header: "1-90 days", numeric: true },
                { header: "Over 90 days", numeric: true },
                { header: "Total", numeric: true, strong: true },
              ]}
              rows={byClient.map((r) => [
                r.customer_name as string,
                Number(r.current) ? money(Number(r.current)) : "—",
                money(Number(r.d30) + Number(r.d90)),
                Number(r.over90) ? money(Number(r.over90)) : "—",
                money(Number(r.total)),
              ])}
            />
          </Card>

          <Card padded={false}>
            <div className="p-4 sm:p-5">
              <CardTitle hint="largest 20, over 90 days">Invoice drill-down</CardTitle>
            </div>
            <DataTable
              emptyMessage="Nothing is more than 90 days overdue."
              columns={[
                { header: "Invoice" },
                { header: "Client" },
                { header: "Salesperson" },
                { header: "Due", numeric: false },
                { header: "Days", numeric: true },
                { header: "Balance", numeric: true, strong: true },
              ]}
              rows={worstInvoices.map((r) => [
                r.invoice_number ?? "—",
                r.customer_name,
                r.salesperson?.split(/\s+-\s+/)[0] ?? "—",
                dateLabel(r.due_date),
                <span key="d" className={r.age > 180 ? "text-negative" : "text-caution"}>
                  {r.age}
                </span>,
                money(Number(r.balance_base)),
              ])}
            />
          </Card>

          {snapshots.length > 1 && (
            <p className="text-[11.5px] text-ink-faint">
              {snapshots.length} snapshots loaded. Trend across snapshots is the next addition to
              this page.
            </p>
          )}
        </div>
      </>
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not reach the database.";
    return <SetupRequired message={message} />;
  }
}

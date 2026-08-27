import Link from "next/link";
import { Bar, DataTable, drillColumns, renderDrillRow } from "@/components/DataTable";
import { CustomerPicker } from "@/components/CustomerPicker";
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
import { AR_BUCKETS, arBucketSelect, isDrill, runDrill } from "@/lib/reports/drilldowns";
import { buildCustomerStatement, listCustomers } from "@/lib/reports/customer-statement";
import { fyBounds, fyLabel, fyStartYearOf } from "@/lib/period";
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
/** The colour each shared ageing band is drawn in - presentation, nothing more. */
const BUCKET_TONE: Record<string, string> = {
  current: "bg-positive",
  d30: "bg-navy",
  d90: "bg-series-2",
  d180: "bg-caution",
  d365: "bg-series-5",
  y1: "bg-negative",
};

const bucketSelect = arBucketSelect();

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

    const customers = await listCustomers(entity, ["ar", "invoices", "payments"], verticalId);
    const pickedCustomer = typeof params.customer === "string" ? params.customer : null;
    const customer =
      pickedCustomer && customers.includes(pickedCustomer) ? pickedCustomer : null;

    const scope = [entity.memberIds, verticalId, entity.verticalIds];

    const [totals, byVertical, topTen, unmatched, terms] = await Promise.all([
      queryOne<Record<string, number>>(
        `select ${bucketSelect},
                coalesce(sum(balance_base),0)::numeric total, count(*)::int n
           from ar_open_items
          where ${LATEST_SNAPSHOT} and ($2::int is null or vertical_id=$2)
            ${verticalScope("$3")}`,
        scope,
      ),
      query<Record<string, string | number | null>>(
        `select v.id, v.code, v.name, ${arBucketSelect("a.")},
                coalesce(sum(a.balance_base),0)::numeric total
           from ar_open_items a left join verticals v on v.id=a.vertical_id
          where (a.entity_id, a.as_of) in (
                  select entity_id, max(as_of) from ar_open_items
                   where entity_id = any($1::int[]) group by entity_id)
            and ($2::int is null or a.vertical_id = $2)
            ${verticalScope("$3", "a.vertical_id")}
          group by v.id, v.code, v.name order by total desc`,
        [entity.memberIds, verticalId, entity.verticalIds],
      ),
      /**
       * What the ten largest customers come to, for the concentration tile.
       * The names and their ageing are one click away; the tile only has to
       * say how much of the book sits with them.
       */
      queryOne<{ v: number; n: number }>(
        `select coalesce(sum(t.total),0)::numeric v, count(*)::int n from (
                  select coalesce(sum(balance_base),0)::numeric total
                    from ar_open_items
                   where ${LATEST_SNAPSHOT} and ($2::int is null or vertical_id=$2)
                     ${verticalScope("$3")}
                   group by customer_name
                   order by total desc limit 10) t`,
        scope,
      ),
      queryOne<{ n: number; v: number }>(
        `select count(*)::int n, coalesce(sum(balance_base),0)::numeric v
           from ar_open_items where ${LATEST_SNAPSHOT} and vertical_id is null
             and $2::int is null
             ${verticalScope("$3")}`,
        [entity.memberIds, verticalId, entity.verticalIds],
      ),
      queryOne<{ with_terms: number; total: number }>(
        `select count(*) filter (where due_date > invoice_date)::int with_terms,
                count(*)::int total
           from ar_open_items where ${LATEST_SNAPSHOT}
             and ($2::int is null or vertical_id = $2)
             ${verticalScope("$3")}`,
        [entity.memberIds, verticalId, entity.verticalIds],
      ),
    ]);

    /**
     * The financial year the movements are measured over. Receivables are a
     * snapshot rather than a period, so the page has no year picker - the year
     * containing the snapshot is the only one a statement could mean.
     */
    const statementFy = fyStartYearOf(new Date(`${asOf}T00:00:00`));
    const statement = customer
      ? await buildCustomerStatement({
          entity,
          customer,
          from: fyBounds(statementFy).start,
          asOf,
          verticalId,
        })
      : null;
    const customerRows = customer
      ? await runDrill({
          kind: "receivables",
          drill: "customer",
          entity,
          start: asOf,
          end: asOf,
          verticalId,
          customer,
          limit: DRILL_LIMIT,
        })
      : null;

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
    // Over 180 days is the two oldest bands together; over a year is the last
    // of them on its own, and is therefore counted inside the 180-day figure.
    const over180 = Number(totals?.d365 ?? 0) + Number(totals?.y1 ?? 0);
    const overYear = Number(totals?.y1 ?? 0);
    const topTenValue = Number(topTen?.v ?? 0);
    const peakBucket = Math.max(1, ...AR_BUCKETS.map((b) => Number(totals?.[b.key] ?? 0)));

    return (
      <>
        <PageHeader
          title="Receivables"
          subtitle={`As at ${dateLabel(asOf)}${verticalName ? ` · ${verticalName}` : ""} · age measured from the due date`}
          actions={
            <>
              <PeriodControls
                financialYears={[]}
                currentFy={0}
                verticals={verticals.map((v) => ({ id: v.id, name: v.name }))}
                currentVerticalId={verticalId}
              />
              <CustomerPicker customers={customers} current={customer} />
            </>
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
                {
                  key: "top10",
                  label: `Top ${topTen?.n ?? 10} customers`,
                  value: topTenValue,
                  note: `${percent(share(topTenValue, total))} of the book — ageing and each share on click`,
                  tone: "positive",
                },
                { key: "over180", label: "Overdue exceeding 180 days", value: over180, note: `${percent(share(over180, total))} of book`, tone: "caution" },
                { key: "over365", label: "Overdue exceeding 1 year", value: overYear, note: `${percent(share(overYear, total))} of book · collection risk`, tone: "negative" },
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

          {statement && (
            <Card padded={false}>
              <div className="p-4 sm:p-5">
                <CardTitle hint={`${fyLabel(statementFy)} · as at ${dateLabel(asOf)}`}>
                  {statement.customer}
                </CardTitle>
                <DataTable
                  columns={[{ header: "Movement" }, { header: "Amount", numeric: true }]}
                  rows={[
                    [`Opening balance as at ${dateLabel(statement.from)}`, money(statement.opening)],
                    ["Add: invoices raised", statement.invoiced ? money(statement.invoiced) : "—"],
                    [
                      "Less: collections received",
                      statement.collected ? `(${money(statement.collected)})` : "—",
                    ],
                    [
                      "Less: credit notes issued",
                      statement.credited ? `(${money(statement.credited)})` : "—",
                    ],
                    [
                      <span key="c" className="font-semibold">
                        Closing balance as at {dateLabel(asOf)}
                      </span>,
                      <span key="v" className="font-semibold">
                        {money(statement.closing)}
                      </span>,
                    ],
                  ]}
                />
                <div className="mt-4">
                  <CardTitle hint={`${statement.openInvoices} open invoice(s)`}>
                    Outstanding, by age
                  </CardTitle>
                  <div className="space-y-2">
                    {AR_BUCKETS.map((b) => {
                      const value = statement.ageing[b.key] ?? 0;
                      return (
                        <div key={b.key} className="flex items-center gap-3">
                          <span className="w-32 shrink-0 text-[12px] text-ink-muted">{b.label}</span>
                          <Bar
                            max={Math.max(1, ...AR_BUCKETS.map((x) => statement.ageing[x.key] ?? 0))}
                            segments={[
                              { value, className: BUCKET_TONE[b.key], label: `${b.label} ${money(value)}` },
                            ]}
                          />
                          <span className="num w-28 shrink-0 text-right text-[12.5px] font-medium text-ink">
                            {value ? money(value) : "—"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                {/*
                  Only the closing balance is a fact - it is the AR export,
                  invoice by invoice. Working the year's movements back off it
                  is the honest direction for the derivation, and it means any
                  disagreement between the registers lands visibly in the
                  opening balance rather than being spread across the year.
                */}
                <p className="mt-4 text-[11.5px] leading-relaxed text-ink-faint">
                  The closing balance is the AR snapshot itself. Opening balance is what is left
                  when the year&rsquo;s invoices, receipts and credit notes are worked back off
                  it, so a large opening figure against a client who is new this year is a
                  question about the uploaded registers rather than a debt.
                </p>
              </div>
            </Card>
          )}

          {customerRows && (
            <DrillPanel
              title={`${customer} — outstanding invoices`}
              subtitle={
                <>
                  As at {dateLabel(asOf)}
                  {verticalName ? ` · ${verticalName}` : ""} · oldest invoice first
                </>
              }
              closeHref={withParams("/receivables", params, { customer: null })}
              downloadHref={withParams("/api/export", params, {
                kind: "receivables",
                drill: "customer",
                vertical: verticalId,
                customer,
              })}
              shown={customerRows.rows.length}
              total={customerRows.total}
            >
              <DataTable
                columns={drillColumns(customerRows.columns)}
                rows={customerRows.rows.map((r) => renderDrillRow(r, customerRows.columns))}
                emptyMessage="Nothing is outstanding from this customer."
              />
            </DrillPanel>
          )}

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
              {AR_BUCKETS.map((b) => {
                const value = Number(totals?.[b.key] ?? 0);
                return (
                  <div key={b.key} className="flex items-center gap-3">
                    <span className="w-32 shrink-0 text-[12px] text-ink-muted">{b.label}</span>
                    <Bar
                      max={peakBucket}
                      segments={[
                        { value, className: BUCKET_TONE[b.key], label: `${b.label} ${money(value)}` },
                      ]}
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
              <CardTitle hint="click a vertical for its open invoices">By vertical</CardTitle>
            </div>
            <DataTable
              columns={[
                { header: "Vertical" },
                { header: "Total", numeric: true, strong: true },
                ...AR_BUCKETS.map((b) => ({ header: b.label, numeric: true })),
              ]}
              rows={byVertical.map((r) => [
                /*
                  The vertical is the way into its invoices: filtering the page
                  to it and opening the list in one click, which is also what
                  points the Excel download at the same rows. Unallocated has
                  no vertical to filter by, so it stays plain text - the notice
                  above already says what it is.
                */
                r.id ? (
                  <Link
                    key="v"
                    href={withParams("/receivables", params, {
                      vertical: String(r.id),
                      drill: "total",
                      customer: null,
                    })}
                    className="font-medium text-navy hover:underline"
                  >
                    {(r.code as string) ?? (r.name as string)}
                  </Link>
                ) : (
                  "Unallocated"
                ),
                money(Number(r.total)),
                ...AR_BUCKETS.map((b) => (Number(r[b.key]) ? money(Number(r[b.key])) : "—")),
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

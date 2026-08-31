import Link from "next/link";
import { BudgetTable } from "@/components/BudgetTable";
import { CurrencySplit, type CurrencyRow } from "@/components/CurrencySplit";
import { CustomerPicker } from "@/components/CustomerPicker";
import { DataTable, drillColumns, renderDrillRow } from "@/components/DataTable";
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
import { compactINR, dateLabel, money, monthLabel, percent, share } from "@/lib/format";
import { withParams } from "@/lib/href";
import { fyBounds, fyLabel, fyMonths } from "@/lib/period";
import { ledgerWrittenTo, resolvePeriod } from "@/lib/reporting-period";
import { buildBudgetVsActual } from "@/lib/reports/budget";
import { isDrill, runDrill, UNTRACEABLE_RECEIPT } from "@/lib/reports/drilldowns";
import { listCustomers } from "@/lib/reports/customer-statement";
import { requireEntityAccess } from "@/lib/auth/dal";

export const dynamic = "force-dynamic";

/** A drill-down is for reading, not for exporting: past a few hundred rows it stops helping. */
const DRILL_LIMIT = 250;

/**
 * Collections.
 *
 * Reimbursement receipts are kept separate from fee receipts throughout: an RI
 * invoice recovers money the firm laid out on a client's behalf, so counting it
 * as collection performance would flatter the numbers.
 */
export default async function CollectionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireEntityAccess();
  const params = await searchParams;

  try {
    const entity = await getEntity();
    const verticals = await getVerticals(entity);

    const years = await query<{ fy: number }>(
      `select distinct case when extract(month from payment_date) >= 4
                            then extract(year from payment_date)
                            else extract(year from payment_date) - 1 end::int as fy
         from payments where entity_id = any($1::int[]) order by fy desc`,
      [entity.memberIds],
    );
    const availableYears = years.map((y) => y.fy);

    if (availableYears.length === 0) {
      return (
        <>
          <PageHeader title="Collections" />
          <EmptyState title="No payments loaded" href="/upload" cta="Upload Customer Payments">
            Collections are built from the Zoho Customer Payments export. Upload it and this
            page fills in, split between fee and reimbursement receipts.
          </EmptyState>
        </>
      );
    }

    const requestedFy = Number(params.fy);
    const fy = availableYears.includes(requestedFy) ? requestedFy : availableYears[0];
    const months = fyMonths(fy);

    // The period picker drives every figure on the page except the by-month
    // trend, which stays on the full year so the shape of it remains readable.
    const fyRange = fyBounds(fy);
    const period = resolvePeriod({
      fyStartYear: fy,
      latest: await ledgerWrittenTo(entity.memberIds, fy),
      params,
    });
    const { start, end } = period;

    const requestedVertical = Number(params.vertical);
    const verticalId = verticals.some((v) => v.id === requestedVertical) ? requestedVertical : null;
    const verticalName = verticals.find((v) => v.id === verticalId)?.name ?? null;

    /**
     * The budget table names verticals by code, and a link needs the id. Codes
     * that appear more than once - the same code in both companies, seen only
     * in the consolidated view - are left unlinked rather than sent to whichever
     * of them happened to be first.
     */
    const idByCode = new Map<string, number | null>();
    for (const v of verticals) {
      idByCode.set(v.code, idByCode.has(v.code) ? null : v.id);
    }

    /**
     * One customer's receipts, from the start of the year to the end of the
     * chosen period. Not the period alone: what a partner wants of a client is
     * what has come in this year, and one week of it answers nothing.
     */
    const customers = await listCustomers(entity, ["payments"], verticalId);
    const pickedCustomer = typeof params.customer === "string" ? params.customer : null;
    const customer =
      pickedCustomer && customers.includes(pickedCustomer) ? pickedCustomer : null;

    const [totals, byMonth, byVertical, unmatched, byCurrency] = await Promise.all([
      queryOne<{ fee: number; ri: number; n: number }>(
        `select coalesce(sum(case when a.is_reimbursement then 0 else a.amount_base end),0)::numeric fee,
                coalesce(sum(case when a.is_reimbursement then a.amount_base else 0 end),0)::numeric ri,
                count(distinct p.id)::int n
           from payment_allocations a join payments p on p.id = a.payment_id
          where a.entity_id = any($1::int[]) and p.payment_date between $2 and $3
            and ($4::int is null or a.vertical_id = $4)
            ${verticalScope("$5", "a.vertical_id")}`,
        [entity.memberIds, start, end, verticalId, entity.verticalIds],
      ),
      query<{ m: string; fee: number; ri: number }>(
        `select to_char(p.payment_date,'YYYY-MM') m,
                sum(case when a.is_reimbursement then 0 else a.amount_base end)::numeric fee,
                sum(case when a.is_reimbursement then a.amount_base else 0 end)::numeric ri
           from payment_allocations a join payments p on p.id = a.payment_id
          where a.entity_id = any($1::int[]) and p.payment_date between $2 and $3
            and ($4::int is null or a.vertical_id = $4)
            ${verticalScope("$5", "a.vertical_id")}
          group by 1`,
        [entity.memberIds, fyRange.start, fyRange.end, verticalId, entity.verticalIds],
      ),
      query<{ code: string | null; name: string | null; fee: number; ri: number }>(
        `select v.code, v.name,
                sum(case when a.is_reimbursement then 0 else a.amount_base end)::numeric fee,
                sum(case when a.is_reimbursement then a.amount_base else 0 end)::numeric ri
           from payment_allocations a
           join payments p on p.id = a.payment_id
           left join verticals v on v.id = a.vertical_id
          where a.entity_id = any($1::int[]) and p.payment_date between $2 and $3
            and ($4::int is null or a.vertical_id = $4)
            ${verticalScope("$5", "a.vertical_id")}
          group by v.code, v.name
          order by sum(a.amount_base) desc`,
        [entity.memberIds, start, end, verticalId, entity.verticalIds],
      ),
      // Exactly the population the "unmatched" drill lists, so the count in the
      // notice and the rows in the table below it can never disagree.
      queryOne<{ n: number; v: number }>(
        `select count(distinct p.id)::int n, coalesce(sum(a.amount_base),0)::numeric v
           from payment_allocations a join payments p on p.id = a.payment_id
          where a.entity_id = any($1::int[]) and p.payment_date between $2 and $3
            and ${UNTRACEABLE_RECEIPT}
            and ($4::int is null or a.vertical_id = $4)
            ${verticalScope("$5", "a.vertical_id")}`,
        [entity.memberIds, start, end, verticalId, entity.verticalIds],
      ),
      /**
       * Receipts by the currency they arrived in.
       *
       * The foreign figure lives on the receipt, not the allocation, so it is
       * shared out in the same proportion the rupees were - a dollar receipt
       * split across three invoices contributes three parts of one payment,
       * never three whole ones.
       */
      query<{ currency: string; n: number; inr: number; foreign: number | null }>(
        `select p.currency,
                count(distinct p.id)::int as n,
                sum(a.amount_base)::numeric as inr,
                sum(case when p.amount_foreign is null or p.amount_base = 0 then 0
                         else p.amount_foreign * (a.amount_base / p.amount_base) end)::numeric as foreign
           from payment_allocations a join payments p on p.id = a.payment_id
          where a.entity_id = any($1::int[]) and p.payment_date between $2 and $3
            and ($4::int is null or a.vertical_id = $4)
            ${verticalScope("$5", "a.vertical_id")}
          group by p.currency
          order by sum(a.amount_base) desc`,
        [entity.memberIds, start, end, verticalId, entity.verticalIds],
      ),
    ]);

    // One row is not a split; a company that only ever bills in rupees gets a
    // table that says nothing it did not already know.
    const currencyRows: CurrencyRow[] = byCurrency.map((r) => ({
      currency: r.currency,
      count: Number(r.n),
      inr: Number(r.inr),
      foreign: r.foreign === null || Number(r.foreign) === 0 ? null : Number(r.foreign),
    }));
    const showCurrencySplit = currencyRows.length > 1;

    /**
     * A currency picked off the split above. Validated against the currencies
     * actually present rather than taken as given - an arbitrary code in the
     * query string would otherwise open an empty panel under a confident
     * heading, which reads as no invoices rather than no such currency.
     */
    const requestedCurrency =
      typeof params.currency === "string" ? params.currency.toUpperCase() : null;
    const currency =
      requestedCurrency && currencyRows.some((r) => r.currency.toUpperCase() === requestedCurrency)
        ? requestedCurrency
        : null;


    const budget = await buildBudgetVsActual({
      entity,
      fyStartYear: fy,
      verticalId,
      measure: "collection",
      period: { start, end, fraction: period.fraction, monthAligned: period.monthAligned },
      cumulative: period.cumulative
        ? {
            start: period.cumulative.start,
            end: period.cumulative.end,
            fraction: period.cumulative.fraction,
            label: period.cumulative.shortLabel,
            monthAligned: period.cumulative.monthAligned,
          }
        : null,
    });

    const customerRows = customer
      ? await runDrill({
          kind: "collections",
          drill: "customer",
          entity,
          start: fyRange.start,
          end,
          verticalId,
          customer,
          limit: DRILL_LIMIT,
        })
      : null;

    // The receipts behind a tile, from the same definition the Excel export uses.
    const drill = typeof params.drill === "string" ? params.drill : null;
    const chosen = isDrill("collections", drill)
      ? await runDrill({
          kind: "collections",
          drill,
          entity,
          start,
          end,
          verticalId,
          currency,
          limit: DRILL_LIMIT,
        })
      : null;

    // The same three figures for the year to date behind the chosen week or
    // month. One quiet week reads like a crisis without the run-rate beside it.
    const toDate = period.cumulative
      ? await queryOne<{ fee: number; ri: number; n: number }>(
          `select coalesce(sum(case when a.is_reimbursement then 0 else a.amount_base end),0)::numeric fee,
                  coalesce(sum(case when a.is_reimbursement then a.amount_base else 0 end),0)::numeric ri,
                  count(distinct p.id)::int n
             from payment_allocations a join payments p on p.id = a.payment_id
            where a.entity_id = any($1::int[]) and p.payment_date between $2 and $3
              and ($4::int is null or a.vertical_id = $4)
              ${verticalScope("$5", "a.vertical_id")}`,
          [
            entity.memberIds,
            period.cumulative.start,
            period.cumulative.end,
            verticalId,
            entity.verticalIds,
          ],
        )
      : null;

    const fee = Number(totals?.fee ?? 0);
    const ri = Number(totals?.ri ?? 0);
    const total = fee + ri;
    const cumFee = Number(toDate?.fee ?? 0);
    const cumRi = Number(toDate?.ri ?? 0);

    /**
     * The window the headline speaks for: the year to date up to the chosen
     * week or month, or the year to date itself. A single week of budget is
     * not what anyone means by "period budget" - week 21 falls in August, so
     * the budget behind it is five months of the year, which is the firm own
     * convention and the same rule the Revenue page follows.
     */
    const leadWindow = period.cumulative ?? period;
    const headline = {
      annual: budget.total.annual,
      ...(period.cumulative ? budget.total.cumulative! : budget.total.period),
    };

    const monthMap = new Map(byMonth.map((r) => [r.m, r]));
    const peak = Math.max(
      1,
      ...months.map((m) => {
        const row = monthMap.get(m.key);
        return Number(row?.fee ?? 0) + Number(row?.ri ?? 0);
      }),
    );

    return (
      <>
        <PageHeader
          title="Collections"
          subtitle={`${fyLabel(fy)} · ${period.label}${verticalName ? ` · ${verticalName}` : ""} · fee receipts shown separately from reimbursement recoveries`}
          actions={
            <>
              <PeriodControls
                financialYears={availableYears}
                currentFy={fy}
                verticals={verticals.map((v) => ({ id: v.id, name: v.name }))}
                currentVerticalId={verticalId}
                months={period.months.map((m) => ({ value: m.key, label: m.label }))}
                weeks={period.weeks.map((w) => ({ value: String(w.number), label: w.label }))}
                currentMonth={period.monthKey}
                currentWeek={period.weekNumber === null ? null : String(period.weekNumber)}
              />
              <CustomerPicker customers={customers} current={customer} />
            </>
          }
        />

        <div className="space-y-4">
          {/*
            The budget position leads, exactly as it does on Revenue: what was
            targeted for the period, what came in against it, and how far that
            got. The three receipt tiles below are the register behind the
            Actual figure, and stay put because the drill-downs hang off them.
          */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <KpiTile label="Annual Budget" value={compactINR(headline.annual)} note={fyLabel(fy)} />
            <KpiTile
              label="Period Budget"
              value={compactINR(headline.periodBudget)}
              note={leadWindow.basis}
            />
            <KpiTile
              label="Actual"
              value={compactINR(headline.actual)}
              note="Fee receipts, excluding reimbursement recoveries"
              tone="positive"
              cumulative={
                period.cumulative
                  ? { label: period.shortLabel, value: compactINR(budget.total.period.actual) }
                  : undefined
              }
            />
            <KpiTile
              label="% Achievement"
              value={headline.achievement === null ? "—" : percent(headline.achievement, 2)}
              note="Actual against period budget"
              tone={
                headline.achievement === null
                  ? "ink"
                  : headline.achievement >= 100
                    ? "positive"
                    : headline.achievement >= 85
                      ? "ink"
                      : "caution"
              }
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {(
              [
                {
                  key: "total",
                  label: "Total collected",
                  value: total,
                  note: `${totals?.n ?? 0} receipts`,
                  tone: "ink",
                  toDate: cumFee + cumRi,
                },
                {
                  key: "fee",
                  label: "Fee collections",
                  value: fee,
                  note: `${percent(share(fee, total))} of receipts`,
                  tone: "positive",
                  toDate: cumFee,
                },
                {
                  key: "ri",
                  label: "Reimbursement recoveries",
                  value: ri,
                  note: "Client costs recovered, not fee income",
                  tone: "caution",
                  toDate: cumRi,
                },
              ] as const
            ).map((tile) => (
              <KpiTile
                key={tile.key}
                label={tile.label}
                value={compactINR(period.cumulative ? tile.toDate : tile.value)}
                note={period.cumulative ? period.cumulative.shortLabel : tile.note}
                tone={tile.tone}
                active={drill === tile.key}
                href={withParams("/collections", params, {
                  drill: drill === tile.key ? null : tile.key,
                })}
                cumulative={
                  period.cumulative
                    ? { label: period.shortLabel, value: compactINR(tile.value) }
                    : undefined
                }
              />
            ))}
          </div>

          {customerRows && (
            <DrillPanel
              title={customer!}
              subtitle={
                <>
                  {fyLabel(fy)} · every receipt from {dateLabel(fyRange.start)} to{" "}
                  {dateLabel(end)}
                  {verticalName ? ` · ${verticalName}` : ""} · earliest first
                </>
              }
              closeHref={withParams("/collections", params, { customer: null })}
              downloadHref={withParams("/api/export", params, {
                kind: "collections",
                drill: "customer",
                fy,
                vertical: verticalId,
                customer,
              })}
              shown={customerRows.rows.length}
              total={customerRows.total}
            >
              <DataTable
                columns={drillColumns(customerRows.columns)}
                rows={customerRows.rows.map((r) => renderDrillRow(r, customerRows.columns))}
                emptyMessage="Nothing has been received from this customer in the year to date."
              />
            </DrillPanel>
          )}

          {chosen && (
            <DrillPanel
              title={chosen.title}
              subtitle={
                <>
                  {fyLabel(fy)}
                  {verticalName ? ` · ${verticalName}` : ""}
                  {currency ? ` · received in ${currency}` : ""} · amounts are the part of each
                  receipt that falls in this tile. Unallocated is the receipt&rsquo;s own
                  unapplied balance — Zoho does not split it between fee and reimbursement.
                </>
              }
              closeHref={withParams("/collections", params, { drill: null, currency: null })}
              downloadHref={withParams("/api/export", params, {
                kind: "collections",
                fy,
                vertical: verticalId,
              })}
              shown={chosen.rows.length}
              total={chosen.total}
            >
              <DataTable
                columns={drillColumns(chosen.columns)}
                rows={chosen.rows.map((r) => renderDrillRow(r, chosen.columns))}
                emptyMessage="No receipts of this kind in the period."
              />
            </DrillPanel>
          )}

          {(unmatched?.n ?? 0) > 0 && (
            <Notice
              tone="info"
              title={`${compactINR(Number(unmatched?.v ?? 0))} not traced to an invoice`}
              action={
                <Link
                  href={withParams("/collections", params, {
                    drill: drill === "unmatched" ? null : "unmatched",
                  })}
                  scroll={false}
                  className="whitespace-nowrap rounded-md border border-navy/25 px-2.5 py-1.5 text-[12px] font-medium hover:bg-navy/5"
                >
                  {drill === "unmatched" ? "Close" : "Show them"}
                </Link>
              }
            >
              {unmatched?.n} receipt{unmatched?.n === 1 ? "" : "s"} carry no invoice reference
              in Zoho, or name an invoice that is in no uploaded register. They are counted in
              the totals above, but nothing says what they settled — so they cannot be split
              between fee and reimbursement, or attributed to a vertical, on any evidence.
              Loading the missing invoice register, or filling the reference in on the receipt,
              clears them.
            </Notice>
          )}

          {showCurrencySplit && (
            <Card padded={false}>
              <div className="px-4 pt-4 sm:px-5">
                <CardTitle hint={period.shortLabel}>Collected by currency</CardTitle>
              </div>
              <CurrencySplit
                rows={currencyRows}
                countLabel="Receipts"
                active={currency}
                hrefFor={(code) =>
                  withParams("/collections", params, {
                    currency: currency === code.toUpperCase() ? null : code,
                    drill: currency === code.toUpperCase() ? null : "total",
                    customer: null,
                  })
                }
              />
            </Card>
          )}

          <Card padded={false}>
            <div className="px-4 pt-4 sm:px-5">
              <CardTitle
                hint={`${period.cumulative?.shortLabel ?? period.shortLabel} · ${
                  period.cumulative?.basis ?? period.basis
                }`}
              >
                Budget vs actual by vertical
              </CardTitle>
            </div>
            <BudgetTable
              data={budget}
              periodLabel={period.shortLabel}
              periodBasis={period.basis}
              cumulativeBasis={period.cumulative?.basis ?? null}
              hrefFor={(row) => {
                const id = row.code ? idByCode.get(row.code) : null;
                return id
                  ? withParams("/collections", params, {
                      vertical: String(id),
                      drill: "fee",
                      customer: null,
                    })
                  : null;
              }}
            />
            {budget.hasUnbudgeted && (
              <p className="px-4 pb-4 text-[11.5px] text-caution sm:px-5">
                A line with no annual budget carries receipts belonging to a vertical nobody
                budgeted for, or to none at all. It is listed so the actuals still add up to
                the figure above.
              </p>
            )}
          </Card>

          <Card>
            <CardTitle hint={`peak month ${compactINR(peak)} · full year`}>
              Collections by month
            </CardTitle>
            <div className="space-y-1.5">
              {months.map((m) => {
                const row = monthMap.get(m.key);
                const f = Number(row?.fee ?? 0);
                const r = Number(row?.ri ?? 0);
                const sum = f + r;
                return (
                  <div key={m.key} className="flex items-center gap-3">
                    <span className="w-14 shrink-0 text-[11.5px] text-ink-muted">
                      {monthLabel(m.end)}
                    </span>
                    <div className="flex h-5 flex-1 overflow-hidden rounded-sm bg-surface-sunk">
                      <div
                        className="bg-navy"
                        style={{ width: `${(f / peak) * 100}%` }}
                        title={`Fee ${money(f)}`}
                      />
                      <div
                        className="bg-caution/70"
                        style={{ width: `${(r / peak) * 100}%` }}
                        title={`Reimbursement ${money(r)}`}
                      />
                    </div>
                    <span className="num w-24 shrink-0 text-right text-[12px] text-ink">
                      {sum ? money(sum) : "—"}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="mt-3 flex items-center gap-4 text-[11px] text-ink-muted">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-3 rounded-sm bg-navy" /> Fee
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-3 rounded-sm bg-caution/70" /> Reimbursement
              </span>
            </p>
          </Card>

          <Card padded={false}>
            <div className="p-4 sm:p-5">
              <CardTitle hint="click a vertical for its receipts">By vertical</CardTitle>
            </div>
            <DataTable
              columns={[
                { header: "Vertical" },
                { header: "Fee", numeric: true },
                { header: "Reimbursement", numeric: true },
                { header: "Total", numeric: true, strong: true },
              ]}
              rows={byVertical.map((r) => {
                const id = r.code ? idByCode.get(r.code as string) : null;
                return [
                  id ? (
                    <Link
                      key="v"
                      href={withParams("/collections", params, {
                        vertical: String(id),
                        drill: "fee",
                        customer: null,
                      })}
                      className="font-medium text-navy hover:underline"
                    >
                      {r.code as string}
                    </Link>
                  ) : (
                    ((r.code as string) ?? "Unmatched")
                  ),
                  money(Number(r.fee)),
                  Number(r.ri) ? money(Number(r.ri)) : "—",
                  money(Number(r.fee) + Number(r.ri)),
                ];
              })}
            />
          </Card>

        </div>
      </>
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not reach the database.";
    return <SetupRequired message={message} />;
  }
}


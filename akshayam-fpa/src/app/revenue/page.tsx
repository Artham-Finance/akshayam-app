import Link from "next/link";
import { BudgetTable } from "@/components/BudgetTable";
import { Bar, DataTable, drillColumns, renderDrillRow } from "@/components/DataTable";
import { CurrencySplit, type CurrencyRow } from "@/components/CurrencySplit";
import { RetainerTable } from "@/components/RetainerTable";
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
import { compactINR, money, monthLabel, percent, share } from "@/lib/format";
import { withParams } from "@/lib/href";
import { fyBounds, fyLabel, fyMonths } from "@/lib/period";
import { ledgerWrittenTo, resolvePeriod } from "@/lib/reporting-period";
import { buildBudgetVsActual } from "@/lib/reports/budget";
import { isDrill, runDrill } from "@/lib/reports/drilldowns";
import { buildRetainerBreakdown } from "@/lib/reports/retainers";
import { requireEntityAccess } from "@/lib/auth/dal";

export const dynamic = "force-dynamic";

/**
 * Revenue.
 *
 * Two deductions matter and both are shown rather than buried:
 *   - void / rejected / draft invoices and credit notes are excluded outright
 *   - credit notes are netted off, because they reduce ledger revenue but never
 *     appear in the Invoice Details export
 * Reimbursement (RI) invoices are recharges of client-paid costs, so they are
 * reported separately from fee revenue throughout.
 */
const EXCLUDED_STATUS = ["void", "rejected", "draft"];

/** A drill-down is for reading, not for exporting: past a few hundred rows it stops helping. */
const DRILL_LIMIT = 250;

export default async function RevenuePage({
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
      `select distinct case when extract(month from invoice_date) >= 4
                            then extract(year from invoice_date)
                            else extract(year from invoice_date) - 1 end::int as fy
         from invoice_lines where entity_id = any($1::int[]) order by fy desc`,
      [entity.memberIds],
    );
    const availableYears = years.map((y) => y.fy);

    if (availableYears.length === 0) {
      return (
        <>
          <PageHeader title="Revenue" />
          <EmptyState title="No invoices loaded" href="/upload" cta="Upload Invoice Details">
            Revenue is built from the Zoho Invoice Details export, netted against Credit Note
            Details. Upload both and this page fills in.
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

    const args = [entity.memberIds, start, end, verticalId, EXCLUDED_STATUS, entity.verticalIds];

    const [totals, credits, byMonth, cnByMonth, byVertical, byClient, bySalesperson, excluded, byCurrency, retainers] =
      await Promise.all([
        queryOne<{ fee: number; ri: number; n: number }>(
          `select coalesce(sum(case when is_reimbursement then 0 else amount_base end),0)::numeric fee,
                  coalesce(sum(case when is_reimbursement then amount_base else 0 end),0)::numeric ri,
                  count(*)::int n
             from invoice_lines
            where entity_id=any($1::int[]) and invoice_date between $2 and $3
              and ($4::int is null or vertical_id=$4) and not (status = any($5))
              ${verticalScope("$6")}`,
          args,
        ),
        queryOne<{ v: number; n: number }>(
          `select coalesce(sum(cn_amount_base),0)::numeric v, count(*)::int n
             from credit_notes
            where entity_id=any($1::int[]) and credit_note_date between $2 and $3
              and ($4::int is null or vertical_id=$4)
              and is_primary_row and not (status = any($5))
              ${verticalScope("$6")}`,
          [entity.memberIds, start, end, verticalId, EXCLUDED_STATUS, entity.verticalIds],
        ),
        query<{ m: string; fee: number; ri: number }>(
          `select to_char(invoice_date,'YYYY-MM') m,
                  sum(case when is_reimbursement then 0 else amount_base end)::numeric fee,
                  sum(case when is_reimbursement then amount_base else 0 end)::numeric ri
             from invoice_lines
            where entity_id=any($1::int[]) and invoice_date between $2 and $3
              and ($4::int is null or vertical_id=$4) and not (status = any($5))
              ${verticalScope("$6")}
            group by 1`,
          [entity.memberIds, fyRange.start, fyRange.end, verticalId, EXCLUDED_STATUS, entity.verticalIds],
        ),
        query<{ m: string; v: number }>(
          `select to_char(credit_note_date,'YYYY-MM') m, sum(cn_amount_base)::numeric v
             from credit_notes
            where entity_id=any($1::int[]) and credit_note_date between $2 and $3
              and ($4::int is null or vertical_id=$4)
              and is_primary_row and not (status = any($5))
              ${verticalScope("$6")}
            group by 1`,
          [entity.memberIds, fyRange.start, fyRange.end, verticalId, EXCLUDED_STATUS, entity.verticalIds],
        ),
        query<{ code: string | null; name: string | null; fee: number; ri: number; cn: number }>(
          `select v.code, v.name,
                  coalesce(sum(case when i.is_reimbursement then 0 else i.amount_base end),0)::numeric fee,
                  coalesce(sum(case when i.is_reimbursement then i.amount_base else 0 end),0)::numeric ri,
                  coalesce((select sum(cn.cn_amount_base) from credit_notes cn
                             where cn.entity_id=i.entity_id and cn.vertical_id=i.vertical_id
                               and cn.is_primary_row and not (cn.status = any($4))
                               and cn.credit_note_date between $2 and $3
                               ${verticalScope("$5", "cn.vertical_id")}),0)::numeric cn
             from invoice_lines i left join verticals v on v.id=i.vertical_id
            where i.entity_id=any($1::int[]) and i.invoice_date between $2 and $3 and not (i.status = any($4))
              ${verticalScope("$5", "i.vertical_id")}
            group by v.code, v.name, i.entity_id, i.vertical_id
            order by 3 desc`,
          [entity.memberIds, start, end, EXCLUDED_STATUS, entity.verticalIds],
        ),
        query<{ customer_name: string; fee: number; ri: number }>(
          `select customer_name,
                  sum(case when is_reimbursement then 0 else amount_base end)::numeric fee,
                  sum(case when is_reimbursement then amount_base else 0 end)::numeric ri
             from invoice_lines
            where entity_id=any($1::int[]) and invoice_date between $2 and $3
              and ($4::int is null or vertical_id=$4) and not (status = any($5))
              ${verticalScope("$6")}
            group by customer_name order by 2 desc limit 12`,
          args,
        ),
        query<{ salesperson: string | null; fee: number }>(
          `select salesperson, sum(case when is_reimbursement then 0 else amount_base end)::numeric fee
             from invoice_lines
            where entity_id=any($1::int[]) and invoice_date between $2 and $3
              and ($4::int is null or vertical_id=$4) and not (status = any($5))
              ${verticalScope("$6")}
            group by salesperson order by 2 desc limit 12`,
          args,
        ),
        queryOne<{ n: number; v: number }>(
          `select count(*)::int n, coalesce(sum(amount_base),0)::numeric v
             from invoice_lines
            where entity_id=any($1::int[]) and invoice_date between $2 and $3 and status = any($4)
              ${verticalScope("$5")}`,
          [entity.memberIds, start, end, EXCLUDED_STATUS, entity.verticalIds],
        ),
        /**
         * Invoiced by the currency it was billed in.
         *
         * Zoho's export converts every amount to INR and leaves exchange_rate
         * to get back, so the billed figure is amount ÷ rate. Multiplying is
         * the classic mistake and inflates a dollar invoice ninety-fold.
         */
        query<{ currency: string; n: number; inr: number; foreign: number }>(
          `select coalesce(currency, 'INR') as currency,
                  count(*)::int as n,
                  sum(amount_base)::numeric as inr,
                  sum(amount_base / nullif(exchange_rate, 0))::numeric as foreign
             from invoice_lines
            where entity_id=any($1::int[]) and invoice_date between $2 and $3
              and ($4::int is null or vertical_id=$4) and not (status = any($5))
              ${verticalScope("$6")}
            group by 1
            order by sum(amount_base) desc`,
          args,
        ),
        // The retainer list is a whole-year picture by design: a retainer that
        // stopped in June is invisible in a period that starts after it.
        buildRetainerBreakdown({ entity, fyStartYear: fy, verticalId }),
      ]);

    // One row is not a split; a company that only ever bills in rupees gets a
    // table that says nothing it did not already know.
    const currencyRows: CurrencyRow[] = byCurrency.map((r) => ({
      currency: r.currency,
      count: Number(r.n),
      inr: Number(r.inr),
      foreign:
        r.currency.toUpperCase() === "INR" || r.foreign === null ? null : Number(r.foreign),
    }));
    const showCurrencySplit = currencyRows.length > 1;

    const budget = await buildBudgetVsActual({
      entity,
      fyStartYear: fy,
      verticalId,
      measure: "revenue",
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

    // The documents behind a tile, from the same definition the Excel export uses.
    const drill = typeof params.drill === "string" ? params.drill : null;
    const chosen = isDrill("revenue", drill)
      ? await runDrill({
          kind: "revenue",
          drill,
          entity,
          start,
          end,
          verticalId,
          limit: DRILL_LIMIT,
        })
      : null;

    // The same figures for the year to date behind the chosen week or month.
    // One quiet week reads like a crisis without the run-rate beside it.
    const toDate = period.cumulative
      ? await queryOne<{ fee: number; ri: number; cn: number }>(
          `select coalesce(sum(case when i.is_reimbursement then 0 else i.amount_base end),0)::numeric fee,
                  coalesce(sum(case when i.is_reimbursement then i.amount_base else 0 end),0)::numeric ri,
                  coalesce((select sum(cn.cn_amount_base) from credit_notes cn
                             where cn.entity_id = any($1::int[])
                               and cn.credit_note_date between $2 and $3
                               and ($4::int is null or cn.vertical_id = $4)
                               and cn.is_primary_row and not (cn.status = any($5))
                               ${verticalScope("$6", "cn.vertical_id")}),0)::numeric cn
             from invoice_lines i
            where i.entity_id = any($1::int[]) and i.invoice_date between $2 and $3
              and ($4::int is null or i.vertical_id = $4) and not (i.status = any($5))
              ${verticalScope("$6", "i.vertical_id")}`,
          [
            entity.memberIds,
            period.cumulative.start,
            period.cumulative.end,
            verticalId,
            EXCLUDED_STATUS,
            entity.verticalIds,
          ],
        )
      : null;

    const fee = Number(totals?.fee ?? 0);
    const ri = Number(totals?.ri ?? 0);
    const cn = Number(credits?.v ?? 0);

    /**
     * The window the headline speaks for: the year to date up to the chosen
     * week or month, or the year to date itself. A single week's budget is not
     * what anyone means by "period budget" - week 21 falls in August, so the
     * budget behind it is five months of the year, which is also the firm's own
     * convention.
     */
    const leadWindow = period.cumulative ?? period;
    const headline = {
      annual: budget.total.annual,
      ...(period.cumulative ? budget.total.cumulative! : budget.total.period),
    };

    // The invoice register behind that figure, for the note under the tiles.
    const cumFeeInvoiced = Number(toDate?.fee ?? fee);
    const cumCnValue = Number(toDate?.cn ?? cn);
    const cumRiValue = Number(toDate?.ri ?? ri);

    const monthMap = new Map(byMonth.map((r) => [r.m, r]));
    const cnMap = new Map(cnByMonth.map((r) => [r.m, Number(r.v)]));
    const peak = Math.max(
      1,
      ...months.map((m) => Number(monthMap.get(m.key)?.fee ?? 0) + Number(monthMap.get(m.key)?.ri ?? 0)),
    );

    const clientTotal = byClient.reduce((s, r) => s + Number(r.fee), 0);
    const topThree = byClient.slice(0, 3).reduce((s, r) => s + Number(r.fee), 0);

    return (
      <>
        <PageHeader
          title="Revenue"
          subtitle={`${fyLabel(fy)} · ${period.label}${verticalName ? ` · ${verticalName}` : ""} · invoiced fee revenue, net of credit notes`}
          actions={
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
          }
        />

        <div className="space-y-4">
          {/*
            The headline is the budget position, not the invoice register: what
            was targeted for the period, what the ledger actually earned, and
            the gap. Gross invoiced and the credit-note deduction are still
            reachable - they hang off the Actual tile and the note below - but
            they are workings, and workings do not belong in the six numbers a
            partner reads first.
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
              note="Net of credit notes · matches the P&L"
              tone="positive"
              active={drill === "fee"}
              href={withParams("/revenue", params, { drill: drill === "fee" ? null : "fee" })}
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
            <KpiTile
              label="Professional fee"
              value={headline.professional === null ? "—" : compactINR(headline.professional)}
              note={
                headline.professional === null
                  ? "Billed monthly — not split for a single week"
                  : `${percent(share(headline.professional, headline.actual))} of revenue`
              }
            />
            <KpiTile
              label="Recurring retainership fee"
              value={headline.retainership === null ? "—" : compactINR(headline.retainership)}
              note={
                headline.retainership === null
                  ? "Billed monthly — not split for a single week"
                  : `${percent(share(headline.retainership, headline.actual))} of revenue`
              }
            />
          </div>

          <Notice tone="info" title={`${compactINR(cumFeeInvoiced)} invoiced, ${compactINR(cumCnValue)} credited`}>
            Actual above is the ledger&rsquo;s revenue line. The invoice register shows{" "}
            {compactINR(cumFeeInvoiced)} of fee raised less {compactINR(cumCnValue)} of credit
            notes, and {compactINR(cumRiValue)} of reimbursements billed — recharges of
            client-paid costs, which are reported separately and never counted as fee income.
            <span className="mt-1 block">
              {(
                [
                  ["fee", "Fee invoices"],
                  ["credit_notes", "Credit notes"],
                  ["ri", "Reimbursement invoices"],
                ] as const
              ).map(([key, label], i) => (
                <span key={key}>
                  {i > 0 && " · "}
                  <Link
                    href={withParams("/revenue", params, { drill: drill === key ? null : key })}
                    scroll={false}
                    className="font-medium underline underline-offset-2"
                  >
                    {drill === key ? `Close ${label.toLowerCase()}` : label}
                  </Link>
                </span>
              ))}
            </span>
          </Notice>

          {chosen && (
            <DrillPanel
              title={chosen.title}
              subtitle={
                <>
                  {fyLabel(fy)}
                  {verticalName ? ` · ${verticalName}` : ""} · amounts are ex-tax, newest first
                </>
              }
              closeHref={withParams("/revenue", params, { drill: null })}
              downloadHref={withParams("/api/export", params, {
                kind: "revenue",
                fy,
                vertical: verticalId,
              })}
              shown={chosen.rows.length}
              total={chosen.total}
            >
              <DataTable
                columns={drillColumns(chosen.columns)}
                rows={chosen.rows.map((r) => renderDrillRow(r, chosen.columns))}
                emptyMessage="No documents of this kind in the period."
              />
            </DrillPanel>
          )}


          {(excluded?.n ?? 0) > 0 && (
            <Notice
              tone="info"
              title={`${excluded?.n} invoice(s) excluded — ${compactINR(Number(excluded?.v ?? 0))}`}
              action={
                <Link
                  href={withParams("/revenue", params, {
                    drill: drill === "excluded" ? null : "excluded",
                  })}
                  scroll={false}
                  className="whitespace-nowrap rounded-md border border-navy/25 px-2.5 py-1.5 text-[12px] font-medium hover:bg-navy/5"
                >
                  {drill === "excluded" ? "Close" : "Show them"}
                </Link>
              }
            >
              Void, rejected and draft invoices are left out of every figure on this page, so
              revenue here agrees with the ledger rather than the raw invoice register.
            </Notice>
          )}

          {showCurrencySplit && (
            <Card padded={false}>
              <div className="px-4 pt-4 sm:px-5">
                <CardTitle hint={period.shortLabel}>Invoiced by currency</CardTitle>
              </div>
              <CurrencySplit rows={currencyRows} countLabel="Invoices" />
            </Card>
          )}

          {retainers.rows.length > 0 && (
            <Card padded={false}>
              <div className="px-4 pt-4 sm:px-5">
                <CardTitle hint={`${fyLabel(fy)} · whole year`}>
                  Recurring retainership fee by customer
                </CardTitle>
              </div>
              <RetainerTable
                data={retainers}
                // With one vertical picked the column would repeat the picker.
                showVertical={verticalId === null}
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
            />
            <p className="px-4 pb-4 text-[11.5px] text-ink-muted sm:px-5">
              Actual is the ledger&rsquo;s Revenue from Operations, so it is net of credit
              notes and equals the P&amp;L line exactly. It will differ from the invoiced
              figure above where an invoice was raised in one period and posted in another.
            </p>
            {budget.hasUnbudgeted && (
              <p className="px-4 pb-4 text-[11.5px] text-caution sm:px-5">
                A line with no annual budget carries revenue that belongs to a vertical nobody
                budgeted for, or to none at all. It is listed so the actuals still add up to
                the figure above.
              </p>
            )}
          </Card>

          <Card>
            <CardTitle hint={`peak month ${compactINR(peak)} · full year`}>
              Invoiced by month
            </CardTitle>
            <div className="space-y-1.5">
              {months.map((m) => {
                const row = monthMap.get(m.key);
                const f = Number(row?.fee ?? 0);
                const r = Number(row?.ri ?? 0);
                const credit = cnMap.get(m.key) ?? 0;
                return (
                  <div key={m.key} className="flex items-center gap-3">
                    <span className="w-14 shrink-0 text-[11.5px] text-ink-muted">
                      {monthLabel(m.end)}
                    </span>
                    <Bar
                      max={peak}
                      segments={[
                        { value: f, className: "bg-navy", label: `Fee ${money(f)}` },
                        { value: r, className: "bg-caution/70", label: `Reimbursement ${money(r)}` },
                      ]}
                    />
                    <span className="num w-24 shrink-0 text-right text-[12px] text-ink">
                      {f + r ? money(f + r) : "—"}
                    </span>
                    <span className="num w-20 shrink-0 text-right text-[11.5px] text-negative">
                      {credit ? `(${money(credit)})` : ""}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="mt-3 flex flex-wrap items-center gap-4 text-[11px] text-ink-muted">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-3 rounded-sm bg-navy" /> Fee
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-3 rounded-sm bg-caution/70" /> Reimbursement
              </span>
              <span className="text-negative">( ) credit notes raised that month</span>
            </p>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card padded={false}>
              <div className="p-4 sm:p-5">
                <CardTitle>By vertical</CardTitle>
              </div>
              <DataTable
                columns={[
                  { header: "Vertical" },
                  { header: "Fee", numeric: true },
                  { header: "Credit notes", numeric: true },
                  { header: "Net", numeric: true, strong: true },
                  { header: "Reimbursement", numeric: true },
                ]}
                rows={byVertical.map((r) => [
                  r.code ?? "Unallocated",
                  money(Number(r.fee)),
                  Number(r.cn) ? `(${money(Number(r.cn))})` : "—",
                  money(Number(r.fee) - Number(r.cn)),
                  money(Number(r.ri)),
                ])}
              />
            </Card>

            <Card padded={false}>
              <div className="p-4 sm:p-5">
                <CardTitle
                  hint={`top 3 = ${percent(share(topThree, clientTotal))} of fees`}
                >
                  By client
                </CardTitle>
              </div>
              <DataTable
                columns={[
                  { header: "Client" },
                  { header: "Fee", numeric: true, strong: true },
                  { header: "Share", numeric: true },
                  { header: "Reimbursement", numeric: true },
                ]}
                rows={byClient.map((r) => [
                  r.customer_name,
                  money(Number(r.fee)),
                  percent(share(Number(r.fee), clientTotal)),
                  money(Number(r.ri)),
                ])}
              />
            </Card>
          </div>

          <Card padded={false}>
            <div className="p-4 sm:p-5">
              <CardTitle hint="fee invoices only">By salesperson</CardTitle>
            </div>
            <DataTable
              columns={[
                { header: "Salesperson" },
                { header: "Fee invoiced", numeric: true, strong: true },
                { header: "Share", numeric: true },
              ]}
              rows={bySalesperson.map((r) => [
                r.salesperson ?? "Unassigned",
                money(Number(r.fee)),
                percent(share(Number(r.fee), fee)),
              ])}
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

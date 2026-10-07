import Link from "next/link";
import { BudgetTable } from "@/components/BudgetTable";
import { Bar, DataTable, drillColumns, renderDrillRow } from "@/components/DataTable";
import { CurrencySplit, type CurrencyRow } from "@/components/CurrencySplit";
import { CustomerPicker } from "@/components/CustomerPicker";
import { PeriodControls } from "@/components/PeriodControls";
import { PeriodLink } from "@/components/PeriodLink";
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
import { getEntity, getVerticalsInScope, verticalScope } from "@/lib/entity";
import { compactINR, dateLabel, money, monthLabel, percent, share } from "@/lib/format";
import { withParams } from "@/lib/href";
import { fyBounds, fyLabel, fyMonths } from "@/lib/period";
import { revenueActualsByMonthParts } from "@/lib/reports/budget-trend";
import {
  getReportingPeriod,
  ledgerAsOfLabel,
  ledgerWrittenTo,
} from "@/lib/reporting-period";
import { buildBudgetVsActual } from "@/lib/reports/budget";
import { isDrill, runDrill } from "@/lib/reports/drilldowns";
import { listCustomers } from "@/lib/reports/customer-statement";
import {
  buildReimbursementReco,
  hasReimbursementBillLines,
} from "@/lib/reports/reimbursement-reco";
import { requireEntityAccess, requireReportAccess } from "@/lib/auth/dal";

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
  await requireReportAccess("revenue");
  const params = await searchParams;

  try {
    const entity = await getEntity();
    const verticals = await getVerticalsInScope(entity);

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

    // The global reporting period drives every figure on the page except the
    // by-month trend, which stays on the full year so its shape stays readable.
    const preview = await getReportingPeriod(entity, availableYears);
    const writtenTo = await ledgerWrittenTo(entity.memberIds, preview.fyStartYear);
    const period = await getReportingPeriod(entity, availableYears, writtenTo);
    const fy = period.fyStartYear;
    const months = fyMonths(fy);
    const fyRange = fyBounds(fy);
    const { start, end } = period;
    /** the picked month, when the period is exactly one calendar month */
    const monthKey =
      period.periodMonths.length === 1 && period.monthAligned
        ? period.periodMonths[0].key
        : null;

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
     * One customer's invoices, from the start of the year up to the end of the
     * chosen period. Deliberately not the period alone: the question a partner
     * asks of a client is what they have been billed this year, and a single
     * week of it answers nothing.
     */
    const customers = await listCustomers(entity, ["invoices"], verticalId);
    const picked = typeof params.customer === "string" ? params.customer : null;
    const customer = picked && customers.includes(picked) ? picked : null;

    const args = [entity.memberIds, start, end, verticalId, EXCLUDED_STATUS, entity.verticalIds];

    const [totals, credits, byMonth, byVertical, cnByVertical, retainerByVertical, byCurrency] =
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
        queryOne<{ fee: number; ri: number; n: number }>(
          /*
            A credit note against an RI invoice reverses a recharge, not fee
            income - it is raised because a client-paid cost never actually
            landed, the same reason the invoice itself carries is_reimbursement.
            Split here for exactly the reason invoice_lines already is: setting
            an RI credit note off against fee would understate fee revenue and
            overstate reimbursement by the same rupee.
          */
          `select coalesce(sum(case when is_reimbursement then 0 else cn_amount_base end),0)::numeric fee,
                  coalesce(sum(case when is_reimbursement then cn_amount_base else 0 end),0)::numeric ri,
                  count(*)::int n
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
        /**
         * Invoiced by vertical.
         *
         * Grouped on the vertical alone, with credit notes and retainers
         * brought alongside as their own queries rather than as correlated
         * sub-selects. Three simple aggregates that each read like what they
         * are beat one query that has to carry the entity through its group-by
         * just to keep a sub-select honest.
         */
        query<{ id: number | null; code: string | null; name: string | null; fee: number; ri: number }>(
          `select v.id, v.code, v.name,
                  coalesce(sum(case when i.is_reimbursement then 0 else i.amount_base end),0)::numeric fee,
                  coalesce(sum(case when i.is_reimbursement then i.amount_base else 0 end),0)::numeric ri
             from invoice_lines i left join verticals v on v.id=i.vertical_id
            where i.entity_id=any($1::int[]) and i.invoice_date between $2 and $3
              and not (i.status = any($4))
              and ($5::int is null or i.vertical_id = $5)
              ${verticalScope("$6", "i.vertical_id")}
            group by v.id, v.code, v.name
            order by 4 desc`,
          [entity.memberIds, start, end, EXCLUDED_STATUS, verticalId, entity.verticalIds],
        ),
        query<{ vertical_id: number | null; cnFee: number; cnRi: number }>(
          `select vertical_id,
                  coalesce(sum(case when is_reimbursement then 0 else cn_amount_base end),0)::numeric "cnFee",
                  coalesce(sum(case when is_reimbursement then cn_amount_base else 0 end),0)::numeric "cnRi"
             from credit_notes
            where entity_id=any($1::int[]) and credit_note_date between $2 and $3
              and is_primary_row and not (status = any($4))
              and ($5::int is null or vertical_id = $5)
              ${verticalScope("$6")}
            group by vertical_id`,
          [entity.memberIds, start, end, EXCLUDED_STATUS, verticalId, entity.verticalIds],
        ),
        /**
         * The retainer half of each vertical's fee.
         *
         * Only meaningful over whole months: a retainer is billed monthly, so a
         * single week has no defensible share of one and inventing a fifth of a
         * month's retainer would put a figure on the page no invoice supports.
         */
        period.monthAligned
          ? query<{ vertical_id: number | null; amount: number }>(
              `select vertical_id, coalesce(sum(amount_base),0)::numeric amount
                 from retainer_revenue
                where entity_id=any($1::int[]) and month between $2 and $3
                  and ($4::int is null or vertical_id = $4)
                  ${verticalScope("$5")}
                group by vertical_id`,
              [entity.memberIds, start, end, verticalId, entity.verticalIds],
            )
          : Promise.resolve([] as { vertical_id: number | null; amount: number }[]),
        /**
         * Invoiced by the currency it was billed in.
         *
         * Fee only - professional plus retainership, the same two tiles this
         * feeds - and net of credit notes, so this card foots to the Actual
         * tile above it exactly. Reimbursement is a recharge of a client-paid
         * cost, never fee income, and a credit note here is set off against
         * the fee it was raised against; both are excluded the same way the
         * Actual figure already excludes them.
         *
         * Zoho's export converts every amount to INR and leaves exchange_rate
         * to get back, so the billed figure is amount ÷ rate. Multiplying is
         * the classic mistake and inflates a dollar invoice ninety-fold.
         */
        query<{ currency: string; n: number; inr: number; foreign: number }>(
          `with fee as (
             select coalesce(currency, 'INR') as currency,
                    count(*)::int as n,
                    sum(amount_base)::numeric as inr,
                    sum(amount_base / nullif(exchange_rate, 0))::numeric as foreign
               from invoice_lines
              where entity_id=any($1::int[]) and invoice_date between $2 and $3
                and not is_reimbursement
                and ($4::int is null or vertical_id=$4) and not (status = any($5))
                ${verticalScope("$6")}
              group by 1
           ),
           cn as (
             select coalesce(currency, 'INR') as currency,
                    sum(cn_amount_base)::numeric as inr,
                    sum(cn_amount_base / nullif(exchange_rate, 0))::numeric as foreign
               from credit_notes
              where entity_id=any($1::int[]) and credit_note_date between $2 and $3
                and is_primary_row and not is_reimbursement
                and ($4::int is null or vertical_id=$4) and not (status = any($5))
                ${verticalScope("$6")}
              group by 1
           )
           select coalesce(fee.currency, cn.currency) as currency,
                  coalesce(fee.n, 0) as n,
                  coalesce(fee.inr, 0) - coalesce(cn.inr, 0) as inr,
                  coalesce(fee.foreign, 0) - coalesce(cn.foreign, 0) as foreign
             from fee full outer join cn on cn.currency = fee.currency
            order by 3 desc`,
          args,
        ),
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

    // "Actual" ties to the P&L exactly, except here: a revenue-transfer
    // deduction (see the P&L's own card) comes off this figure but never off
    // the ledger-derived statement, so the two diverge on purpose within the
    // window it applies. The tile's caption says so only when it actually did.
    const hasRevenueTransferInWindow =
      entity.slug === "akshayam" &&
      (
        await query<{ exists: boolean }>(
          "select exists(select 1 from revenue_transfer_entries where entity_id = $1 and invoice_date between $2 and $3) as exists",
          [entity.id, start, end],
        )
      )[0]?.exists === true;

    // A compact summary card, not the full page: the whole financial year's
    // running position (same scope /reimbursements itself uses), regardless
    // of whatever period the header picker is showing.
    const reimbursementReco = (await hasReimbursementBillLines(entity.memberIds, entity.verticalIds))
      ? await buildReimbursementReco({ entity, start: fyRange.start, end: fyRange.end, fyStartYear: fy })
      : null;

    const customerRows = customer
      ? await runDrill({
          kind: "revenue",
          drill: "customer",
          entity,
          start: fyRange.start,
          end,
          verticalId,
          customer,
          limit: DRILL_LIMIT,
        })
      : null;

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
          currency,
          limit: DRILL_LIMIT,
        })
      : null;

    // Built once and placed at one of two spots below, depending on which
    // chart the drill came from - see where it is read.
    const chosenPanel = chosen && (
      <DrillPanel
        title={chosen.title}
        subtitle={
          <>
            {fyLabel(fy)}
            {verticalName ? ` · ${verticalName}` : ""}
            {currency ? ` · raised in ${currency}` : ""} · amounts are ex-tax, newest first
          </>
        }
        closeHref={withParams("/revenue", params, { drill: null, currency: null })}
        downloadHref={withParams("/api/export", params, {
          kind: "revenue",
          vertical: verticalId,
        })}
        shown={chosen.rows.length}
        total={chosen.total}
      >
        <DataTable
          columns={drillColumns(chosen.columns)}
          rows={chosen.rows.map((r) => renderDrillRow(r, chosen.columns))}
          topTotals={chosen.totalsRow ? renderDrillRow(chosen.totalsRow, chosen.columns) : undefined}
          emptyMessage="No documents of this kind in the period."
        />
      </DrillPanel>
    );

    // The same figures for the year to date behind the chosen week or month.
    // One quiet week reads like a crisis without the run-rate beside it.
    const toDate = period.cumulative
      ? await queryOne<{ fee: number; ri: number; cnFee: number; cnRi: number }>(
          `select coalesce(sum(case when i.is_reimbursement then 0 else i.amount_base end),0)::numeric fee,
                  coalesce(sum(case when i.is_reimbursement then i.amount_base else 0 end),0)::numeric ri,
                  coalesce((select sum(cn.cn_amount_base) from credit_notes cn
                             where cn.entity_id = any($1::int[])
                               and cn.credit_note_date between $2 and $3
                               and ($4::int is null or cn.vertical_id = $4)
                               and cn.is_primary_row and not cn.is_reimbursement
                               and not (cn.status = any($5))
                               ${verticalScope("$6", "cn.vertical_id")}),0)::numeric "cnFee",
                  coalesce((select sum(cn.cn_amount_base) from credit_notes cn
                             where cn.entity_id = any($1::int[])
                               and cn.credit_note_date between $2 and $3
                               and ($4::int is null or cn.vertical_id = $4)
                               and cn.is_primary_row and cn.is_reimbursement
                               and not (cn.status = any($5))
                               ${verticalScope("$6", "cn.vertical_id")}),0)::numeric "cnRi"
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
    const cnFee = Number(credits?.fee ?? 0);
    const cnRi = Number(credits?.ri ?? 0);

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
    const cumCnFee = Number(toDate?.cnFee ?? cnFee);
    const cumCnRi = Number(toDate?.cnRi ?? cnRi);
    const cumCnValue = cumCnFee + cumCnRi;
    const cumRiValue = Number(toDate?.ri ?? ri);

    const monthMap = new Map(byMonth.map((r) => [r.m, r]));

    /**
     * The month-by-month chart is the Actual figure itself, month by month:
     * the ledger's Revenue from Operations (net of credit notes, the P&L line),
     * plus outside-books billing, less the revenue transferred to RBJV where
     * that applies. The same three sources the Actual tile and the Budget vs
     * Actual statement read, so the months add up to them and agree with the
     * P&L's revenue for the month - not a second measurement from the invoices.
     * Recurring retainership is from its own upload; Professional fee is what
     * is left, as it is on the tiles. Invoices, credit notes and reimbursement
     * stay in the reconciliation beneath it as memo columns.
     */
    const [revenueParts, retainerByMonth, cnSplitByMonth] = await Promise.all([
      revenueActualsByMonthParts(
        entity.memberIds,
        entity.verticalIds,
        verticalId,
        fyRange.start,
        fyRange.end,
      ),
      query<{ m: string; v: number }>(
        `select to_char(month,'YYYY-MM') m, coalesce(sum(amount_base),0)::numeric v
           from retainer_revenue
          where entity_id=any($1::int[]) and month between $2 and $3
            and ($4::int is null or vertical_id=$4)
            ${verticalScope("$5")}
          group by 1`,
        [entity.memberIds, fyRange.start, fyRange.end, verticalId, entity.verticalIds],
      ),
      query<{ m: string; fee: number; ri: number }>(
        `select to_char(credit_note_date,'YYYY-MM') m,
                sum(case when is_reimbursement then 0 else cn_amount_base end)::numeric fee,
                sum(case when is_reimbursement then cn_amount_base else 0 end)::numeric ri
           from credit_notes
          where entity_id=any($1::int[]) and credit_note_date between $2 and $3
            and ($4::int is null or vertical_id=$4)
            and is_primary_row and not (status = any($5))
            ${verticalScope("$6")}
          group by 1`,
        [entity.memberIds, fyRange.start, fyRange.end, verticalId, EXCLUDED_STATUS, entity.verticalIds],
      ),
    ]);
    const sumByMonth = (rows: { month_key: string; actual: number }[]) => {
      const out = new Map<string, number>();
      for (const r of rows) out.set(r.month_key, (out.get(r.month_key) ?? 0) + Number(r.actual));
      return out;
    };
    const glMap = sumByMonth(revenueParts.gl);
    const osbMap = sumByMonth(revenueParts.osb);
    const transferMap = sumByMonth(revenueParts.transferred); // negative: a deduction
    const retainerMap = new Map(retainerByMonth.map((r) => [r.m, Number(r.v)]));
    const cnSplitMap = new Map(cnSplitByMonth.map((r) => [r.m, r]));
    const showOsbStep = revenueParts.osb.some((r) => Number(r.actual) !== 0);
    const showTransferStep = revenueParts.transferred.some((r) => Number(r.actual) !== 0);

    const monthRows = months.map((m) => {
      const gl = glMap.get(m.key) ?? 0;
      const osb = osbMap.get(m.key) ?? 0;
      const transfer = -(transferMap.get(m.key) ?? 0);
      const actual = gl + osb - transfer;
      const retainer = retainerMap.get(m.key) ?? 0;
      const fee = Number(monthMap.get(m.key)?.fee ?? 0);
      const ri = Number(monthMap.get(m.key)?.ri ?? 0);
      const cnFee = Number(cnSplitMap.get(m.key)?.fee ?? 0);
      const cnRi = Number(cnSplitMap.get(m.key)?.ri ?? 0);
      return {
        key: m.key,
        start: m.start,
        end: m.end,
        label: monthLabel(m.end),
        gl,
        osb,
        transfer,
        actual,
        retainer,
        professional: actual - retainer,
        fee,
        cnFee,
        reimbursement: ri - cnRi,
        active: actual !== 0 || fee !== 0 || ri !== 0 || cnFee !== 0 || cnRi !== 0 || transfer !== 0,
      };
    });
    const peak = Math.max(1, ...monthRows.map((r) => r.actual));
    const reconRows = monthRows.filter((r) => r.active);
    const reconTotal = reconRows.reduce(
      (t, r) => ({
        fee: t.fee + r.fee,
        cnFee: t.cnFee + r.cnFee,
        gl: t.gl + r.gl,
        osb: t.osb + r.osb,
        transfer: t.transfer + r.transfer,
        actual: t.actual + r.actual,
        reimbursement: t.reimbursement + r.reimbursement,
      }),
      { fee: 0, cnFee: 0, gl: 0, osb: 0, transfer: 0, actual: 0, reimbursement: 0 },
    );
    const yearActual = reconTotal.actual;

    /**
     * The vertical table, assembled once.
     *
     * Professional fee is the remainder of the fee after the retainer, never a
     * second measurement of it - that is what keeps the two halves adding to
     * the invoiced total exactly rather than to each other approximately.
     */
    const cnFeeByVerticalId = new Map(cnByVertical.map((r) => [r.vertical_id, Number(r.cnFee)]));
    const cnRiByVerticalId = new Map(cnByVertical.map((r) => [r.vertical_id, Number(r.cnRi)]));
    const retainerByVerticalId = new Map(
      retainerByVertical.map((r) => [r.vertical_id, Number(r.amount)]),
    );
    const verticalRows = byVertical.map((r) => {
      const fee = Number(r.fee);
      const retainer = period.monthAligned ? (retainerByVerticalId.get(r.id) ?? 0) : null;
      return {
        id: r.id,
        label: (r.code as string | null) ?? "Unallocated",
        retainer,
        professional: retainer === null ? null : fee - retainer,
        fee,
        // A credit note against an RI invoice reduces reimbursement, not fee -
        // the two credit-note columns below read the same distinction
        // invoice_lines already carries.
        cnFee: cnFeeByVerticalId.get(r.id) ?? 0,
        cnRi: cnRiByVerticalId.get(r.id) ?? 0,
        ri: Number(r.ri),
      };
    });
    const verticalTotals = {
      professional: period.monthAligned
        ? verticalRows.reduce((n, r) => n + (r.professional ?? 0), 0)
        : null,
      retainer: period.monthAligned
        ? verticalRows.reduce((n, r) => n + (r.retainer ?? 0), 0)
        : null,
      fee: verticalRows.reduce((n, r) => n + r.fee, 0),
      cnFee: verticalRows.reduce((n, r) => n + r.cnFee, 0),
      ri: verticalRows.reduce((n, r) => n + r.ri, 0),
      cnRi: verticalRows.reduce((n, r) => n + r.cnRi, 0),
    };
    // Professional fee is what is left of the fee after the retainer, so it goes
    // below nil when the month's retainership list is more than the fee invoiced
    // in it - and money() drops a sign, which would show that as a positive.
    const signedMoney = (n: number) => (n < -0.5 ? `(${money(n)})` : money(n));
    const negativeProfessional = verticalRows.filter((r) => r.professional !== null && r.professional < -0.5);
    // Shared by the pinned copy above the rows and the plain one below them.
    const verticalTotalsRow = [
      "Total",
      verticalTotals.professional === null ? "—" : signedMoney(verticalTotals.professional),
      verticalTotals.retainer ? money(verticalTotals.retainer) : "—",
      money(verticalTotals.fee),
      verticalTotals.cnFee ? `(${money(verticalTotals.cnFee)})` : "—",
      money(verticalTotals.fee - verticalTotals.cnFee),
      verticalTotals.ri - verticalTotals.cnRi ? money(verticalTotals.ri - verticalTotals.cnRi) : "—",
    ];

    return (
      <>
        <PageHeader
          title="Revenue"
          subtitle={`${period.label}${verticalName ? ` · ${verticalName}` : ""}${
            ledgerAsOfLabel(writtenTo) ? ` · ${ledgerAsOfLabel(writtenTo)}` : ""
          } · invoiced fee revenue, net of credit notes`}
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
          {/*
            The headline is the budget position, not the invoice register: what
            was targeted for the period, what the ledger actually earned, and
            the gap. Gross invoiced stays a working - it hangs off the Actual
            tile and the note below - but credit notes raised and reimbursement
            income are read every week and are asked for on the face of the
            page, so they close the block rather than hiding in prose.

            Both sit below the budget position deliberately. Neither is fee
            performance: a credit note is revenue given back, and a
            reimbursement is a client's own cost recharged, so reading either
            as though it were the Actual above it would overstate the week.
          */}
          {/*
            Four tiles a row on a wide screen: the budget position (annual,
            period, actual, achievement) as one line the eye takes in at once,
            the fee/retainer/credit-note/reimbursement line below it as
            another. Narrower screens fall back to two a row and then one -
            the grouping is a column count, not an order, so nothing here
            needs to move to change it.
          */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiTile label="Annual Budget" value={compactINR(headline.annual)} note={fyLabel(fy)} />
            <KpiTile
              label="Period Budget"
              value={compactINR(headline.periodBudget)}
              note={leadWindow.basis}
            />
            <KpiTile
              label="Actual"
              value={compactINR(headline.actual)}
              note={
                hasRevenueTransferInWindow
                  ? "Net of credit notes and revenue transferred to RBJV — see the P&L's own card"
                  : "Net of credit notes · matches the P&L"
              }
              tone="positive"
              active={drill === "fee"}
              href={withParams("/revenue", params, { drill: drill === "fee" ? null : "fee" })}
              exportable
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
              tone="caution"
            />
            <KpiTile
              label="Professional fee"
              value={headline.professional === null ? "—" : compactINR(headline.professional)}
              note={
                headline.professional === null
                  ? "Billed monthly — not split for a single week"
                  : `${percent(share(headline.professional, headline.actual))} of revenue`
              }
              tone="positive"
            />
            {/*
              The customer-by-customer retainer list hangs off this tile rather
              than sitting open on the page. It is the answer to a question the
              tile provokes - which clients are on a retainer, and has one
              stopped - not something to read past on the way to everything
              else.
            */}
            <KpiTile
              label="Recurring retainership fee"
              value={headline.retainership === null ? "—" : compactINR(headline.retainership)}
              note={
                headline.retainership === null
                  ? "Billed monthly — not split for a single week"
                  : `${percent(share(headline.retainership, headline.actual))} of revenue`
              }
              tone="positive"
              active={drill === "retainers"}
              href={
                headline.retainership === null
                  ? undefined
                  : withParams("/revenue", params, {
                      drill: drill === "retainers" ? null : "retainers",
                    })
              }
              exportable
            />
            <KpiTile
              label="Credit notes raised"
              value={compactINR(cumCnValue)}
              note={
                // Fee and reimbursement together, so the share is of what was
                // invoiced overall - the same pairing the currency card and
                // the by-month bar already invoice fee and reimbursement in.
                cumFeeInvoiced + cumRiValue
                  ? `${percent(share(cumCnValue, cumFeeInvoiced + cumRiValue))} of invoiced`
                  : "Deducted from what was invoiced"
              }
              tone="positive"
              active={drill === "credit_notes"}
              href={withParams("/revenue", params, {
                drill: drill === "credit_notes" ? null : "credit_notes",
              })}
              exportable
              cumulative={
                period.cumulative
                  ? { label: period.shortLabel, value: compactINR(cnFee + cnRi) }
                  : undefined
              }
            />
            <KpiTile
              label="Reimbursement income"
              value={compactINR(cumRiValue)}
              note="Client costs recharged · never counted as fee"
              tone="positive"
              active={drill === "ri"}
              href={withParams("/revenue", params, {
                drill: drill === "ri" ? null : "ri",
              })}
              exportable
              cumulative={
                period.cumulative
                  ? { label: period.shortLabel, value: compactINR(ri) }
                  : undefined
              }
            />
          </div>

          <Notice tone="info" title={`${compactINR(cumFeeInvoiced)} invoiced, ${compactINR(cumCnValue)} credited`}>
            Actual above is the ledger&rsquo;s revenue line. The invoice register shows{" "}
            {compactINR(cumFeeInvoiced)} of fee raised less {compactINR(cumCnFee)} of credit
            notes, and {compactINR(cumRiValue)} of reimbursements billed less{" "}
            {compactINR(cumCnRi)} of credit notes against those — recharges of client-paid
            costs, which are reported separately and never counted as fee income. A credit
            note against a reimbursement invoice is set off here, not against fee.
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

          {customerRows && (
            <DrillPanel
              title={customer!}
              subtitle={
                <>
                  {fyLabel(fy)} · every invoice raised from {dateLabel(fyRange.start)} to{" "}
                  {dateLabel(end)}
                  {verticalName ? ` · ${verticalName}` : ""} · oldest first. Fee and
                  reimbursement together, so this is what the client was actually billed.
                </>
              }
              closeHref={withParams("/revenue", params, { customer: null })}
              downloadHref={withParams("/api/export", params, {
                kind: "revenue",
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
                emptyMessage="Nothing was invoiced to this customer in the year to date."
              />
            </DrillPanel>
          )}

          {chosen && chosenPanel}

          {reimbursementReco && (
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle hint={`FY ${fy}-${String(fy + 1).slice(2)} · running position`}>
                    RE / RI Reconciliation
                  </CardTitle>
                  <p className="-mt-2 text-[12.5px] text-ink-muted">
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
                </div>
                <Link
                  href="/reimbursements"
                  className="whitespace-nowrap rounded-md border border-line px-3 py-1.5 text-[12.5px] font-medium text-navy hover:bg-surface-sunk"
                >
                  View full reconciliation →
                </Link>
              </div>
            </Card>
          )}

          {showCurrencySplit && (
            <Card padded={false}>
              <div className="px-4 pt-4 sm:px-5">
                <CardTitle hint={period.shortLabel}>Invoiced by currency</CardTitle>
              </div>
              <CurrencySplit
                rows={currencyRows}
                countLabel="Invoices"
                active={currency}
                hrefFor={(code) =>
                  withParams("/revenue", params, {
                    // Clicking the live currency again closes the panel, the
                    // way the tiles above already behave.
                    currency: currency === code.toUpperCase() ? null : code,
                    drill: currency === code.toUpperCase() ? null : "all",
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
                  ? withParams("/revenue", params, {
                      vertical: String(id),
                      drill: "fee",
                      customer: null,
                    })
                  : null;
              }}
            />
            <p className="px-4 pb-4 text-[11.5px] text-ink-muted sm:px-5">
              Actual is the ledger&rsquo;s Revenue from Operations and equals the P&amp;L line
              exactly — net of the ledger&rsquo;s own credit-note postings. The By vertical
              table below is built the same way, so its Net column matches this vertical for
              vertical.
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
            <CardTitle
              hint={`peak month ${compactINR(peak)} · full year · ties to Actual above · click a month to view it`}
            >
              Revenue by month
            </CardTitle>
            <div className="space-y-1.5">
              {monthRows.map((r) => {
                // Bars cannot go below nothing: where the retainership list is
                // more than the month's revenue the figures still say so, but
                // the bar is drawn within the revenue there is.
                const proBar = Math.max(0, r.professional);
                const retBar = r.actual > 0 ? Math.min(r.retainer, r.actual) : 0;
                const live = monthKey === r.key;
                const content = (
                  <>
                    <span className="w-14 shrink-0 text-[11.5px] text-ink-muted">{r.label}</span>
                    <Bar
                      max={peak}
                      segments={[
                        { value: proBar, className: "bg-navy", label: `Professional fee ${money(r.professional)}` },
                        { value: retBar, className: "bg-caution/70", label: `Recurring retainership ${money(r.retainer)}` },
                      ]}
                    />
                    <span className="num w-24 shrink-0 text-right text-[12px] text-ink">
                      {r.actual ? (r.actual < 0 ? `(${money(r.actual)})` : money(r.actual)) : "—"}
                    </span>
                  </>
                );
                return r.actual !== 0 ? (
                  <PeriodLink
                    key={r.key}
                    from={r.start}
                    to={r.end}
                    active={live}
                    activeClassName="bg-surface-sunk/50"
                    className="-mx-1 flex w-full items-center gap-3 rounded-sm px-1 text-left transition-colors hover:bg-surface-sunk/50"
                  >
                    {content}
                  </PeriodLink>
                ) : (
                  <div key={r.key} className="flex items-center gap-3">
                    {content}
                  </div>
                );
              })}
              <div className="mt-1.5 flex items-center gap-3 border-t border-line pt-1.5 font-semibold">
                <span className="w-14 shrink-0 text-[11.5px] text-ink">Total</span>
                <span className="flex-1" />
                <span className="num w-24 shrink-0 text-right text-[12px] text-ink">
                  {money(yearActual)}
                </span>
              </div>
            </div>
            <p className="mt-3 flex flex-wrap items-center gap-4 text-[11px] text-ink-muted">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-3 rounded-sm bg-navy" /> Professional fee
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-3 rounded-sm bg-caution/70" /> Recurring retainership fee
              </span>
            </p>
            <p className="mt-2 text-[11.5px] text-ink-muted">
              Each month is the ledger&rsquo;s Revenue from Operations - the P&amp;L line, net of
              credit notes
              {showOsbStep ? ", plus billing outside the books" : ""}
              {showTransferStep ? ", less the revenue transferred to RBJV" : ""} - which is what the
              Actual tile above is made of, so the months add up to it. The tile stops at the last
              completed week ({dateLabel(period.cumulative?.end ?? period.end)}); this chart runs the
              full year. Recurring retainership is from its own upload and Professional fee is the
              rest.
            </p>

            <div className="mt-5 border-t border-line pt-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-faint">
                Reconciliation to the invoices
              </p>
              <p className="mt-1 text-[11.5px] text-ink-muted">
                The first two columns are what was invoiced and credited in the month, from the
                invoice data; the ledger&rsquo;s revenue is what the P&amp;L reports. Reimbursement is
                not revenue: it is the invoiced recharge less credit notes raised against it, and
                sits in the P&amp;L&rsquo;s Net Reimbursable Cost line.
              </p>
              <div className="table-frame mt-2">
                <table className="w-full min-w-max border-collapse text-[12.5px]">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-[0.08em] text-ink-faint">
                      <th scope="col" className="px-2 py-1.5 text-left font-medium">Month</th>
                      <th scope="col" className="px-2 py-1.5 text-right font-medium">Fee invoiced</th>
                      <th scope="col" className="px-2 py-1.5 text-right font-medium">Credit notes</th>
                      <th scope="col" className="px-2 py-1.5 text-right font-medium">Revenue per ledger / P&amp;L</th>
                      {showOsbStep && (
                        <th scope="col" className="px-2 py-1.5 text-right font-medium">Outside books</th>
                      )}
                      {showTransferStep && (
                        <th scope="col" className="px-2 py-1.5 text-right font-medium">Transferred to RBJV</th>
                      )}
                      <th scope="col" className="px-2 py-1.5 text-right font-medium">Revenue in chart / Actual</th>
                      <th scope="col" className="px-2 py-1.5 text-right font-medium">Reimbursement, net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reconRows.map((r) => (
                      <tr key={r.key} className="hover:bg-surface-sunk/40">
                        <th scope="row" className="border-t border-line px-2 py-1.5 text-left font-normal text-ink">
                          {r.label}
                        </th>
                        <td className="num border-t border-line px-2 py-1.5 text-right text-ink-muted">{money(r.fee)}</td>
                        <td className="num border-t border-line px-2 py-1.5 text-right text-negative">
                          {r.cnFee ? `(${money(r.cnFee)})` : "—"}
                        </td>
                        <td className="num border-t border-line px-2 py-1.5 text-right text-ink">{money(r.gl)}</td>
                        {showOsbStep && (
                          <td className="num border-t border-line px-2 py-1.5 text-right text-ink-muted">
                            {r.osb ? money(r.osb) : "—"}
                          </td>
                        )}
                        {showTransferStep && (
                          <td className="num border-t border-line px-2 py-1.5 text-right text-negative">
                            {r.transfer ? `(${money(r.transfer)})` : "—"}
                          </td>
                        )}
                        <td className="num border-t border-line px-2 py-1.5 text-right font-medium text-ink">{money(r.actual)}</td>
                        <td className="num border-t border-line px-2 py-1.5 text-right text-ink-muted">{money(r.reimbursement)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="font-semibold text-ink">
                      <th scope="row" className="border-t border-line-strong px-2 py-1.5 text-left">Total</th>
                      <td className="num border-t border-line-strong px-2 py-1.5 text-right">{money(reconTotal.fee)}</td>
                      <td className="num border-t border-line-strong px-2 py-1.5 text-right text-negative">
                        {reconTotal.cnFee ? `(${money(reconTotal.cnFee)})` : "—"}
                      </td>
                      <td className="num border-t border-line-strong px-2 py-1.5 text-right">{money(reconTotal.gl)}</td>
                      {showOsbStep && (
                        <td className="num border-t border-line-strong px-2 py-1.5 text-right">
                          {reconTotal.osb ? money(reconTotal.osb) : "—"}
                        </td>
                      )}
                      {showTransferStep && (
                        <td className="num border-t border-line-strong px-2 py-1.5 text-right text-negative">
                          {reconTotal.transfer ? `(${money(reconTotal.transfer)})` : "—"}
                        </td>
                      )}
                      <td className="num border-t border-line-strong px-2 py-1.5 text-right">{money(reconTotal.actual)}</td>
                      <td className="num border-t border-line-strong px-2 py-1.5 text-right">{money(reconTotal.reimbursement)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </Card>

          <Card padded={false}>
            <div className="p-4 sm:p-5">
              <CardTitle hint="click a vertical for its invoices">By vertical</CardTitle>
            </div>
            <DataTable
              columns={[
                { header: "Vertical" },
                { header: "Professional fee", numeric: true },
                { header: "Recurring retainership fee", numeric: true },
                { header: "Total", numeric: true, strong: true },
                { header: "Credit notes", numeric: true },
                { header: "Net", numeric: true, strong: true },
                { header: "Reimbursement", numeric: true },
              ]}
              rows={verticalRows.map((r) => [
                /*
                  The vertical is the way into its invoices: filtering the page
                  to it and opening the list in one go, which is also what
                  points the Excel download at the same rows. Unallocated has no
                  vertical to filter by, so it stays plain text.
                */
                r.id ? (
                  <Link
                    key="v"
                    href={withParams("/revenue", params, {
                      vertical: String(r.id),
                      drill: "fee",
                      customer: null,
                    })}
                    className="font-medium text-navy hover:underline"
                  >
                    {r.label}
                  </Link>
                ) : (
                  r.label
                ),
                r.professional === null ? "—" : signedMoney(r.professional),
                r.retainer === null ? "—" : r.retainer ? money(r.retainer) : "—",
                money(r.fee),
                r.cnFee ? `(${money(r.cnFee)})` : "—",
                money(r.fee - r.cnFee),
                // Net of its own credit notes too - one raised against an RI
                // invoice reverses a recharge, not fee income, so it belongs
                // here rather than in the Credit notes column to its left.
                r.ri - r.cnRi ? money(r.ri - r.cnRi) : "—",
              ])}
              topTotals={verticalTotalsRow}
            />
            <p className="px-4 pb-4 text-[11.5px] text-ink-muted sm:px-5">
              Reimbursement is net of credit notes raised against those invoices, the same way
              Net is fee net of the credit notes column beside it.
            </p>
            {negativeProfessional.length > 0 && (
              <p className="px-4 pb-4 text-[11.5px] text-caution sm:px-5">
                Professional fee is the fee invoiced less the recurring retainership fee, and for{" "}
                {negativeProfessional.map((r) => r.label).join(", ")} the retainership figure
                (from the Recurring Retainership upload) is more than the fee invoiced in the
                period, so it comes out below nil. Either a retainer invoice the upload counts has
                not reached the invoice data for this month, or it was billed in a different month.
              </p>
            )}
            {!period.monthAligned && (
              <p className="px-4 pb-4 text-[11.5px] text-ink-muted sm:px-5">
                The retainer is billed monthly, so a single week has no
                defensible share of one. Pick a month or the year to date to see
                the professional and retainership split.
              </p>
            )}
          </Card>

        </div>
      </>
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not reach the database.";
    return <SetupRequired message={message} />;
  }
}

import Link from "next/link";
import clsx from "clsx";
import { DataTable, drillColumns, renderDrillRow } from "@/components/DataTable";
import { Card, CardTitle, DownloadExcel, DrillPanel, KpiTile, Notice } from "@/components/ui";
import { TdsRemarkCell } from "@/components/TdsRemarkCell";
import { compactINR, dateLabel, money, moneySigned } from "@/lib/format";
import { withParams, type Params } from "@/lib/href";
import type { Entity } from "@/lib/entity";
import type { QuarterNo } from "@/lib/period";
import { buildTdsReco, tdsDrill, type TdsDrillSide, type TdsSegment } from "@/lib/reports/tds";

/**
 * TDS receivable reconciliation, shown on the Receivables tab.
 *
 * Two records of the same tax credit put side by side: what the books raised
 * when each invoice was approved, and what Form 26AS says the customer actually
 * deducted and deposited. The difference is the output, so it is never netted
 * away - but the part of it caused merely by a deductor name that could not be
 * matched is separated out, because that is a mapping job rather than a tax
 * one and confusing the two wastes the reader's time.
 *
 * Struck one quarter at a time - Form 26AS is downloaded from the income tax
 * portal once a quarter, so a range spanning two would compare a whole filing
 * against a partial one. A quarter whose 26AS has not been uploaded yet still
 * shows its books side; every customer just falls into "in books, not in Form
 * 26AS" until the statement arrives, which is the fact worth showing rather
 * than an empty card.
 */

const DRILL_LIMIT = 250;

const QUARTER_TAB_LABEL: Record<QuarterNo, string> = {
  1: "Q1 · Apr-Jun",
  2: "Q2 · Jul-Sep",
  3: "Q3 · Oct-Dec",
  4: "Q4 · Jan-Mar",
};

/** Short forms for the segment table; the long ones read as sentences. */
const SEGMENT_TITLE: Record<TdsSegment, string> = {
  matched: "Matched — books and Form 26AS agree",
  difference: "Difference between books and Form 26AS",
  books_only: "In books, not in Form 26AS",
  ret_only: "In Form 26AS, not in books",
};

/** A difference this small is rounding, not a discrepancy worth colouring. */
const MATERIAL = 1;

function DiffCell({ value }: { value: number }) {
  if (Math.abs(value) < MATERIAL) return <span className="text-ink-faint">—</span>;
  return (
    <span className={value > 0 ? "text-caution" : "text-negative"}>{moneySigned(value)}</span>
  );
}

function QuarterTabs({ quarter, params }: { quarter: QuarterNo; params: Params }) {
  const chip = "rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors whitespace-nowrap";
  return (
    <div className="flex flex-wrap items-center gap-1">
      {([1, 2, 3, 4] as const).map((q) => (
        <Link
          key={q}
          href={withParams("/receivables", params, {
            tdsQ: q,
            tds: null,
            tdsSide: null,
            tdsSeg: null,
            tdsVert: null,
          })}
          scroll={false}
          className={clsx(
            chip,
            q === quarter
              ? "bg-navy text-ink-invert"
              : "border border-line text-ink-muted hover:bg-surface-sunk",
          )}
        >
          {QUARTER_TAB_LABEL[q]}
        </Link>
      ))}
    </div>
  );
}

export async function TdsRecoSection({
  entity,
  fyStartYear,
  quarter,
  verticalId,
  customer,
  params,
}: {
  entity: Entity;
  fyStartYear: number;
  quarter: QuarterNo;
  verticalId: number | null;
  customer: string | null;
  params: Params;
}) {
  const reco = await buildTdsReco({ entity, fyStartYear, quarter, verticalId, customer });

  if (!reco.hasData) {
    return (
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>TDS receivable reconciliation</CardTitle>
          <QuarterTabs quarter={quarter} params={params} />
        </div>
        <p className="text-[13px] leading-relaxed text-ink-muted">
          Nothing booked in the books and nothing uploaded from Form 26AS for{" "}
          {reco.quarterLabel} yet. Once either side has something - an invoice with TDS
          withheld, or the quarter&rsquo;s tax statement from the{" "}
          <Link href="/upload" className="text-navy hover:underline">
            Upload
          </Link>{" "}
          tab - it will show here.
        </p>
      </Card>
    );
  }

  /* The Unallocated vertical has no id to filter the page by, so it opens
     its own panel instead of behaving like the other vertical links. */
  const showUnallocated = params.tdsVert === "unallocated";

  const drillCustomer = typeof params.tds === "string" ? params.tds : null;
  const sideParam = typeof params.tdsSide === "string" ? params.tdsSide : "books";
  const side: TdsDrillSide =
    sideParam === "26as" ? "26as" : sideParam === "invoice" ? "invoice" : "books";
  const drill = drillCustomer
    ? await tdsDrill(entity, fyStartYear, quarter, side, drillCustomer, DRILL_LIMIT)
    : null;
  const drillTotalsRow = drill
    ? [
        "Total",
        ...drill.columns.slice(1).map((c, i) => (i === drill.columns.length - 2 ? money(drill.total) : "")),
      ]
    : undefined;

  const unmatchedValue = reco.unmatchedDeductors.reduce((s, d) => s + d.taxDeducted, 0);

  const exportParams = (segment?: TdsSegment) => {
    const p = new URLSearchParams({ fy: String(fyStartYear), q: String(quarter) });
    if (verticalId) p.set("vertical", String(verticalId));
    if (customer) p.set("customer", customer);
    if (segment) p.set("segment", segment);
    return `/api/export/tds-reco?${p.toString()}`;
  };
  const exportHref = exportParams();

  const linkFor = (row: { label: string }, s: TdsDrillSide) =>
    withParams("/receivables", params, { tds: row.label, tdsSide: s });

  // Shared by each table's pinned copy above the rows and the plain one below them.
  const byVerticalTotalsRow = [
    "Total",
    money(reco.totals.books),
    money(reco.totals.form26as),
    moneySigned(reco.totals.difference),
  ];
  const unallocatedTotalsRow = [
    `Total — ${reco.unallocated.length} customer${reco.unallocated.length === 1 ? "" : "s"}`,
    money(reco.unallocated.reduce((s, r) => s + r.books, 0)),
    money(reco.unallocated.reduce((s, r) => s + r.form26as, 0)),
    moneySigned(reco.unallocated.reduce((s, r) => s + r.difference, 0)),
  ];
  const byCustomerTotalsRow = [
    reco.byCustomer.length > 60
      ? `Total — all ${reco.byCustomer.length} customers`
      : `Total — ${reco.byCustomer.length} customer${reco.byCustomer.length === 1 ? "" : "s"}`,
    "",
    money(reco.totals.books),
    money(reco.totals.form26as),
    moneySigned(reco.totals.difference),
    "",
  ];
  const unmatchedDeductorsTotalsRow = ["Total", "", "", money(unmatchedValue)];

  return (
    <Card padded={false}>
      <div className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <CardTitle
            hint={
              reco.updatedTill ? `26AS updated till ${dateLabel(reco.updatedTill)}` : undefined
            }
          >
            TDS receivable reconciliation
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <DownloadExcel href={exportHref} label="Download invoice breakup" />
            <QuarterTabs quarter={quarter} params={params} />
          </div>
        </div>
        <p className="-mt-1 mb-4 text-[12.5px] text-ink-muted">
          Books against Form 26AS for {reco.quarterLabel} — {dateLabel(reco.period.start)} to{" "}
          {dateLabel(reco.period.end)}. The books raise a TDS receivable when an invoice is
          approved; Form 26AS is what the customer told the department it deducted.
        </p>

        {!reco.has26as && (
          <div className="mb-4">
            <Notice tone="caution" title={`Form 26AS not uploaded for ${reco.quarterLabel}`}>
              The statement for this quarter has not come from the income tax portal yet, so
              everything below is the books side only — every customer falls into &ldquo;in
              books, not in Form 26AS&rdquo; until it does. Download the quarter&rsquo;s
              statement and drop it on the{" "}
              <Link href="/upload" className="underline">
                Upload
              </Link>{" "}
              tab to fill in the other side.
            </Notice>
          </div>
        )}

        {reco.ledgers.length > 0 && (
          <p className="-mt-2 mb-4 text-[12px] leading-relaxed text-ink-faint">
            <span className="font-medium text-ink-muted">
              TDS per books is drawn from {reco.ledgers.length} ledger
              {reco.ledgers.length === 1 ? "" : "s"}:
            </span>{" "}
            {reco.ledgers.map((l, i) => (
              <span key={l.ledger}>
                {i > 0 && " · "}
                {l.ledger} <span className="num text-ink-muted">{money(l.amount)}</span>
              </span>
            ))}
            . Excluded: TDS Payable, which is tax the firm deducted from its own vendors; GST
            TDS on CGST/SGST, which is reported in GSTR-2A and never appears in Form 26AS; and
            the FY 2025-26 customer ledgers (TDS-2526-…), whose credit belongs to the prior
            year&rsquo;s statement.
          </p>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <KpiTile
            label="TDS per books"
            value={compactINR(reco.totals.books)}
            note="Raised against approved invoices"
          />
          <KpiTile
            label="TDS per Form 26AS"
            value={compactINR(reco.totals.form26as)}
            note="Recorded by the department"
          />
          <KpiTile
            label="Difference"
            value={compactINR(reco.totals.difference)}
            note={
              reco.totals.difference > 0
                ? "Booked but not yet in 26AS"
                : "In 26AS but not booked"
            }
            tone={Math.abs(reco.totals.difference) < MATERIAL ? "ink" : "caution"}
          />
        </div>
      </div>

      {reco.unmatchedDeductors.length > 0 && (
        <div className="px-4 pb-4 sm:px-5">
          <Notice
            tone="info"
            title={`${compactINR(unmatchedValue)} sits against ${reco.unmatchedDeductors.length} deductor${
              reco.unmatchedDeductors.length === 1 ? "" : "s"
            } whose name could not be matched to a customer`}
          >
            Their 26AS credit sits in one row while the same customers&rsquo; books entry sits
            in another, so both are already counted and{" "}
            <span className="font-medium">mapping them will not change the total difference</span>.
            What it changes is where they fall below: today they inflate
            &ldquo;in Form 26AS, not in books&rdquo; and its mirror, rather than being compared
            like for like. They are listed at the bottom of this card, and can be matched on{" "}
            <Link href="/settings/tds-deductors" className="underline">
              Settings &rarr; TDS deductors
            </Link>
            .
          </Notice>
        </div>
      )}

      {/*
        The same customers sorted into what you would actually do about them.
        Every customer on the reconciliation is in exactly one segment, so the
        four foot back to the totals above - which is what makes this a way of
        working through the difference rather than another view of it.
      */}
      <div className="border-t border-line">
        <div className="p-4 sm:p-5">
          <CardTitle hint="click a card to download its own invoice breakup">
            Customers by reconciliation status
          </CardTitle>
          <p className="-mt-1 text-[12.5px] leading-relaxed text-ink-muted">
            Every customer with TDS on either side, for the quarter, in one of four
            positions. The last two are the ones that need chasing: a credit the department
            has no record of, or a deduction the books never raised.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 px-4 pb-4 sm:grid-cols-2 sm:px-5 lg:grid-cols-4">
          {reco.segments.map((s) => {
            const amount =
              s.segment === "difference" ? s.difference : s.segment === "ret_only" ? s.form26as : s.books;
            const invoiceCount =
              s.segment === "books_only" ? reco.booksOnlyInvoices.length : null;
            return (
              <KpiTile
                key={s.segment}
                label={SEGMENT_TITLE[s.segment]}
                value={
                  s.segment === "difference" && Math.abs(amount) >= MATERIAL
                    ? moneySigned(amount)
                    : compactINR(amount)
                }
                note={
                  invoiceCount !== null
                    ? `${invoiceCount} invoice${invoiceCount === 1 ? "" : "s"}`
                    : `${s.customers} customer${s.customers === 1 ? "" : "s"}`
                }
                tone={s.segment === "matched" ? "positive" : s.customers > 0 ? "caution" : "ink"}
                href={s.customers > 0 ? exportParams(s.segment) : undefined}
                download
              />
            );
          })}
        </div>
      </div>

      {drill && (
        <div className="px-4 pb-4 sm:px-5">
          <DrillPanel
            title={`${drillCustomer} — ${
              side === "books"
                ? "TDS raised in the books"
                : side === "26as"
                  ? "TDS per Form 26AS"
                  : "Invoices raised in the quarter"
            }`}
            subtitle={
              side === "books"
                ? "Each line is a TDS receivable posted against an approved invoice."
                : side === "26as"
                  ? "Each line is a deduction the customer reported to the income tax department."
                  : "Every invoice raised on this customer in the quarter, with the TDS booked against it and the effective rate. Form 26AS carries no invoice number, so it cannot be shown on these lines."
            }
            closeHref={withParams("/receivables", params, { tds: null, tdsSide: null })}
            shown={drill.rows.length}
            total={drill.rows.length}
          >
            <DataTable
              columns={drillColumns(drill.columns)}
              rows={drill.rows.map((r) => renderDrillRow(r, drill.columns))}
              topTotals={drillTotalsRow}
            />
            {drill.secondary && (
              <div className="mt-4 border-t border-line pt-4">
                <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
                  {drill.secondary.title}
                </p>
                <DataTable
                  columns={drillColumns(drill.secondary.result.columns)}
                  rows={drill.secondary.result.rows.map((r) => renderDrillRow(r, drill.secondary!.result.columns))}
                />
              </div>
            )}
          </DrillPanel>
        </div>
      )}

      <div className="border-t border-line">
        <div className="p-4 sm:p-5">
          <CardTitle>By vertical</CardTitle>
        </div>
        <DataTable
          columns={[
            { header: "Vertical" },
            { header: "Per books", numeric: true },
            { header: "Per 26AS", numeric: true },
            { header: "Difference", numeric: true, strong: true },
          ]}
          rows={reco.byVertical.map((v) => [
            /*
              A vertical drills by filtering the whole page to it, which is what
              the picker at the top already does - so the receivables above and
              this reconciliation stay in step rather than disagreeing about
              which vertical is being looked at. Unallocated has no id to filter
              on and stays plain.
            */
            v.verticalId ? (
              <Link
                key={v.key}
                href={withParams("/receivables", params, {
                  vertical: v.verticalId,
                  tds: null,
                  tdsSide: null,
                  tdsSeg: null,
                })}
                className={clsx(
                  "hover:underline",
                  verticalId === v.verticalId ? "font-semibold text-navy" : "text-navy",
                )}
              >
                {v.label}
              </Link>
            ) : (
              <Link
                key={v.key}
                href={withParams("/receivables", params, {
                  tdsVert: showUnallocated ? null : "unallocated",
                  tds: null,
                  tdsSide: null,
                })}
                className={clsx(
                  "hover:underline",
                  showUnallocated ? "font-semibold text-navy" : "text-navy",
                )}
              >
                {v.label}
              </Link>
            ),
            money(v.books),
            money(v.form26as),
            <DiffCell key={`d-${v.key}`} value={v.difference} />,
          ])}
          topTotals={byVerticalTotalsRow}
        />

        {showUnallocated && (
          <div className="px-4 pb-4 sm:px-5">
            <DrillPanel
              title="Unallocated — TDS with no vertical"
              subtitle={
                "A customer lands here when no invoice in the period tells us which vertical " +
                "served them. On the 26AS side that is usually a deductor whose name is not yet " +
                "matched to a customer; on the books side, a TDS line whose invoice number does " +
                "not join the invoice register."
              }
              closeHref={withParams("/receivables", params, { tdsVert: null })}
              shown={reco.unallocated.length}
              total={reco.unallocated.length}
            >
              <DataTable
                emptyMessage="Nothing unallocated."
                columns={[
                  { header: "Customer" },
                  { header: "Per books", numeric: true },
                  { header: "Per 26AS", numeric: true },
                  { header: "Difference", numeric: true, strong: true },
                ]}
                rows={reco.unallocated.map((r) => [
                  r.label,
                  r.books ? money(r.books) : "—",
                  r.form26as ? money(r.form26as) : "—",
                  <DiffCell key={`u-${r.key}`} value={r.difference} />,
                ])}
                topTotals={unallocatedTotalsRow}
              />
            </DrillPanel>
          </div>
        )}
      </div>

      <div className="border-t border-line">
        <div className="p-4 sm:p-5">
          <CardTitle hint="largest differences first — click a figure for the workings">
            By customer
          </CardTitle>
        </div>
        <DataTable
          emptyMessage="No TDS on either side for this selection."
          columns={[
            { header: "Customer" },
            { header: "Vertical" },
            { header: "Per books", numeric: true },
            { header: "Per 26AS", numeric: true },
            { header: "Difference", numeric: true, strong: true },
            { header: "Remarks" },
          ]}
          rows={reco.byCustomer.slice(0, 60).map((row) => [
            // The name opens the invoice-by-invoice workings; the two figures
            // beside it open the ledger lines and the 26AS lines respectively.
            <Link
              key="c"
              href={linkFor(row, "invoice")}
              className={clsx(
                "hover:underline",
                drillCustomer === row.label && side === "invoice"
                  ? "font-semibold text-navy"
                  : "text-navy",
              )}
            >
              {row.label}
            </Link>,
            row.verticalCode ?? "—",
            row.books ? (
              <Link
                key="b"
                href={linkFor(row, "books")}
                className={clsx("hover:underline", drillCustomer === row.label && side === "books" && "font-semibold text-navy")}
              >
                {money(row.books)}
              </Link>
            ) : (
              "—"
            ),
            row.form26as ? (
              <Link
                key="s"
                href={linkFor(row, "26as")}
                className={clsx("hover:underline", drillCustomer === row.label && side === "26as" && "font-semibold text-navy")}
              >
                {money(row.form26as)}
              </Link>
            ) : (
              "—"
            ),
            <DiffCell key="d" value={row.difference} />,
            <TdsRemarkCell
              key="r"
              fyStartYear={fyStartYear}
              quarter={quarter}
              customer={row.label}
              initialValue={row.remark}
            />,
          ])}
          /*
            The total covers every customer, not just the 60 rows drawn. A
            footer that added up only what is visible would disagree with the
            tiles above, which is worse than a footer that needs one line of
            explanation.
          */
          topTotals={byCustomerTotalsRow}
        />
        {reco.byCustomer.length > 60 && (
          <p className="px-4 py-3 text-[11.5px] text-ink-faint sm:px-5">
            The 60 largest differences are listed; the total above is all{" "}
            {reco.byCustomer.length} customers.
          </p>
        )}
      </div>

      {reco.unmatchedDeductors.length > 0 && (
        <div className="border-t border-line">
          <div className="p-4 sm:p-5">
            <CardTitle hint="need mapping to a customer">
              <Link href="/settings/tds-deductors" className="text-navy hover:underline">
                Unmatched deductors
              </Link>
            </CardTitle>
            <p className="-mt-1 text-[12.5px] leading-relaxed text-ink-muted">
              The name on the deductor&rsquo;s TDS return does not match any customer in the
              sales ledger. Some are simply spelled differently
              (&ldquo;BLUNAV SYSTEM&rdquo; against &ldquo;BLUNAV SYSTEMS&rdquo;); others may be
              a customer billed by the other company, or a deduction that does not belong to
              the firm at all. They are listed rather than guessed at.
            </p>
          </div>
          <DataTable
            columns={[
              { header: "Deductor per 26AS" },
              { header: "TAN" },
              { header: "Lines", numeric: true },
              { header: "TDS", numeric: true, strong: true },
            ]}
            rows={reco.unmatchedDeductors.map((d) => [
              d.deductorName,
              d.tan ?? "—",
              d.lines,
              money(d.taxDeducted),
            ])}
            topTotals={unmatchedDeductorsTotalsRow}
          />
        </div>
      )}
    </Card>
  );
}

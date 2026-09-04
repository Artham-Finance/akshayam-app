import Link from "next/link";
import clsx from "clsx";
import { DataTable, drillColumns, renderDrillRow } from "@/components/DataTable";
import { Card, CardTitle, DrillPanel, KpiTile, Notice } from "@/components/ui";
import { compactINR, dateLabel, money, moneySigned } from "@/lib/format";
import { withParams, type Params } from "@/lib/href";
import type { Entity } from "@/lib/entity";
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
 */

const DRILL_LIMIT = 250;

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

export async function TdsRecoSection({
  entity,
  verticalId,
  customer,
  params,
}: {
  entity: Entity;
  verticalId: number | null;
  customer: string | null;
  params: Params;
}) {
  const reco = await buildTdsReco({ entity, verticalId, customer });

  if (!reco.hasData) {
    return (
      <Card>
        <CardTitle>TDS receivable reconciliation</CardTitle>
        <p className="text-[13px] leading-relaxed text-ink-muted">
          No Form 26AS has been uploaded yet. Download the annual tax statement for the year
          from the income tax portal and drop it on the{" "}
          <Link href="/upload" className="text-navy hover:underline">
            Upload
          </Link>{" "}
          tab, and the tax credits the department has recorded will be reconciled here against
          the TDS receivable raised in the books.
        </p>
      </Card>
    );
  }

  const segParam = typeof params.tdsSeg === "string" ? params.tdsSeg : null;
  const segment: TdsSegment | null =
    segParam === "matched" || segParam === "difference" ||
    segParam === "books_only" || segParam === "ret_only"
      ? segParam
      : null;

  const drillCustomer = typeof params.tds === "string" ? params.tds : null;
  const sideParam = typeof params.tdsSide === "string" ? params.tdsSide : "books";
  const side: TdsDrillSide =
    sideParam === "26as" ? "26as" : sideParam === "invoice" ? "invoice" : "books";
  const drill = drillCustomer ? await tdsDrill(entity, side, drillCustomer, DRILL_LIMIT) : null;

  const unmatchedValue = reco.unmatchedDeductors.reduce((s, d) => s + d.taxDeducted, 0);

  const shownCustomers = segment
    ? reco.byCustomer.filter((r) => r.segment === segment)
    : reco.byCustomer;

  const shownTotals = shownCustomers.reduce(
    (t, r) => ({
      books: t.books + r.books,
      form26as: t.form26as + r.form26as,
      difference: t.difference + r.difference,
    }),
    { books: 0, form26as: 0, difference: 0 },
  );

  const linkFor = (row: { label: string }, s: TdsDrillSide) =>
    withParams("/receivables", params, { tds: row.label, tdsSide: s });

  return (
    <Card padded={false}>
      <div className="p-4 sm:p-5">
        <CardTitle
          hint={
            reco.updatedTill ? `26AS updated till ${dateLabel(reco.updatedTill)}` : undefined
          }
        >
          TDS receivable reconciliation
        </CardTitle>
        <p className="-mt-1 mb-4 text-[12.5px] text-ink-muted">
          Books against Form 26AS for {dateLabel(reco.period!.start)} to{" "}
          {dateLabel(reco.period!.end)}. The books raise a TDS receivable when an invoice is
          approved; Form 26AS is what the customer told the department it deducted.
        </p>

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
            . Excluded: TDS Payable, which is tax the firm deducted from its own vendors, and
            GST TDS on CGST/SGST, which is reported in GSTR-2A and never appears in Form 26AS.
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
          <CardTitle hint="click a segment to list its customers below">
            Customers by reconciliation status
          </CardTitle>
          <p className="-mt-1 text-[12.5px] leading-relaxed text-ink-muted">
            Every customer with TDS on either side, for the quarter, in one of four
            positions. The last two are the ones that need chasing: a credit the department
            has no record of, or a deduction the books never raised.
          </p>
        </div>
        <DataTable
          columns={[
            { header: "Segment" },
            { header: "Customers", numeric: true },
            { header: "Per books", numeric: true },
            { header: "Per 26AS", numeric: true },
            { header: "Difference", numeric: true, strong: true },
          ]}
          rows={reco.segments.map((s) => [
            s.customers ? (
              <Link
                key={s.segment}
                href={withParams("/receivables", params, {
                  tdsSeg: segment === s.segment ? null : s.segment,
                  tds: null,
                  tdsSide: null,
                })}
                className={clsx(
                  "hover:underline",
                  segment === s.segment ? "font-semibold text-navy" : "text-ink",
                )}
              >
                {SEGMENT_TITLE[s.segment]}
              </Link>
            ) : (
              <span key={s.segment} className="text-ink-faint">
                {SEGMENT_TITLE[s.segment]}
              </span>
            ),
            s.customers || "—",
            s.books ? money(s.books) : "—",
            s.form26as ? money(s.form26as) : "—",
            <DiffCell key={`d-${s.segment}`} value={s.difference} />,
          ])}
          footer={[
            "Total",
            reco.byCustomer.length,
            money(reco.totals.books),
            money(reco.totals.form26as),
            moneySigned(reco.totals.difference),
          ]}
        />
        {segment && (
          <p className="px-4 py-3 text-[11.5px] text-ink-faint sm:px-5">
            The customer table below is filtered to{" "}
            <span className="text-ink-muted">{SEGMENT_TITLE[segment]}</span>.{" "}
            <Link
              href={withParams("/receivables", params, { tdsSeg: null })}
              className="text-navy hover:underline"
            >
              Show all customers
            </Link>
          </p>
        )}
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
              footer={[
                "Total",
                ...drill.columns.slice(1).map((c, i) =>
                  i === drill.columns.length - 2 ? money(drill.total) : "",
                ),
              ]}
            />
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
              <span key={v.key}>{v.label}</span>
            ),
            money(v.books),
            money(v.form26as),
            <DiffCell key={`d-${v.key}`} value={v.difference} />,
          ])}
          footer={[
            "Total",
            money(reco.totals.books),
            money(reco.totals.form26as),
            moneySigned(reco.totals.difference),
          ]}
        />
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
          ]}
          rows={shownCustomers.slice(0, 60).map((row) => [
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
          ])}
          /*
            The total covers every customer in the current selection, not just
            the 60 rows drawn. A footer that added up only what is visible would
            disagree with the tiles above and with the segment table, which is
            worse than a footer that needs one line of explanation.
          */
          footer={[
            shownCustomers.length > 60
              ? `Total — all ${shownCustomers.length} customers`
              : `Total — ${shownCustomers.length} customer${shownCustomers.length === 1 ? "" : "s"}`,
            "",
            money(shownTotals.books),
            money(shownTotals.form26as),
            moneySigned(shownTotals.difference),
          ]}
        />
        {shownCustomers.length > 60 && (
          <p className="px-4 py-3 text-[11.5px] text-ink-faint sm:px-5">
            The 60 largest differences are listed; the total above is all{" "}
            {shownCustomers.length} customers in this selection.
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
            footer={["Total", "", "", money(unmatchedValue)]}
          />
        </div>
      )}
    </Card>
  );
}

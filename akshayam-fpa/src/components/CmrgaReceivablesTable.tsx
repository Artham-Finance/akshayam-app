import clsx from "clsx";
import { dateLabel, money } from "@/lib/format";
import type { CmrgaReceivablesResult } from "@/lib/reports/cmrga-receivables";

/**
 * The MAK meeting's CMRGA receivables tab: the open invoices of the discontinued vertical,
 * shifted to other verticals. A summary by vertical, then each vertical's invoices - the
 * amount collected on each since the shift, and when. Read only: the list is the shifted
 * receivables as at the shift date and the collections are read from the receipts.
 */

const th =
  "border-y border-line px-2 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-faint";
const td = "border-b border-line px-2 py-2 align-top";

export function CmrgaReceivablesTable({
  data,
  showInvoices = true,
}: {
  data: CmrgaReceivablesResult;
  /** the invoice-by-invoice list under the summary; the company-level view shows the summary alone */
  showInvoices?: boolean;
}) {
  const { check } = data;
  const agrees = !!check.booksAsOf && Math.abs(check.difference) < 1 && check.mismatches.length === 0;
  const withBooks = !!check.booksAsOf;
  return (
    <div className="divide-y divide-line">
      <section className="px-4 py-3 sm:px-5">
        {/* The list must stay true to the real receivables: shifted balance less collections = what the receivables show. */}
        <p
          className={clsx(
            "mb-3 rounded-md px-3 py-2 text-[12px]",
            !withBooks ? "bg-surface-sunk text-ink-muted" : agrees ? "bg-positive-tint text-positive" : "bg-caution-tint text-caution",
          )}
        >
          {!withBooks ? (
            <>
              No receivables snapshot dated on or after {data.asOf ? dateLabel(data.asOf) : "the shift"} has been
              loaded yet, so the balances below are the shifted balances less what has been collected. They are
              checked against the receivables as soon as one is.
            </>
          ) : agrees ? (
            <>
              Agrees with the receivables as at {dateLabel(check.booksAsOf!)}: the shifted balance less collections
              is <span className="num font-semibold">{money(check.expected, 2)}</span>, and the receivables show
              the same.
            </>
          ) : (
            <>
              Does not agree with the receivables as at {dateLabel(check.booksAsOf!)}: the receivables show{" "}
              <span className="num font-semibold">{money(check.books, 2)}</span>, the shifted balance less
              collections is <span className="num font-semibold">{money(check.expected, 2)}</span> (difference{" "}
              <span className="num font-semibold">{money(Math.abs(check.difference), 2)}</span>
              {check.difference < 0 ? " less" : " more"} in the receivables).
              {check.mismatches.length > 0 && (
                <>
                  {" "}
                  Invoices that differ:{" "}
                  {check.mismatches
                    .slice(0, 6)
                    .map((m) => `${m.invoiceNumber} (receivables ${money(m.books, 2)}, list ${money(m.expected, 2)})`)
                    .join("; ")}
                  {check.mismatches.length > 6 ? `; and ${check.mismatches.length - 6} more` : ""}.
                </>
              )}
            </>
          )}
        </p>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
          Summary — vertical wise
        </h3>
        <div className="table-frame">
          <table className="w-full max-w-3xl border-collapse text-[12.5px]">
            <thead>
              <tr>
                <th className={clsx(th, "text-left")}>Vertical</th>
                <th className={clsx(th, "text-right")}>Invoices</th>
                <th className={clsx(th, "text-right")}>Balance shifted{data.asOf ? ` (${dateLabel(data.asOf)})` : ""}</th>
                <th className={clsx(th, "text-right")}>Collected since</th>
                <th className={clsx(th, "text-right")}>Balance now</th>
                {withBooks && (
                  <th className={clsx(th, "text-right")}>Per receivables ({dateLabel(check.booksAsOf!)})</th>
                )}
              </tr>
            </thead>
            <tbody>
              {data.verticals.map((v) => (
                <tr key={v.verticalId} className="hover:bg-surface-sunk/40">
                  <td className="border-b border-line px-2 py-2 text-ink">{v.label}</td>
                  <td className="num border-b border-line px-2 py-2 text-right text-ink">{v.invoices.length}</td>
                  <td className="num border-b border-line px-2 py-2 text-right text-ink">{money(v.balance, 2)}</td>
                  <td className="num border-b border-line px-2 py-2 text-right text-ink">
                    {v.collected ? money(v.collected, 2) : "—"}
                  </td>
                  <td className="num border-b border-line px-2 py-2 text-right text-ink">{money(v.balanceNow, 2)}</td>
                  {withBooks && (
                    <td
                      className={clsx(
                        "num border-b border-line px-2 py-2 text-right",
                        v.books !== null && Math.abs(v.books - v.expected) >= 1 ? "font-medium text-caution" : "text-ink",
                      )}
                    >
                      {v.books === null ? "—" : money(v.books, 2)}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            {data.verticals.length > 1 && (
              <tfoot>
                <tr className="font-semibold text-ink">
                  <td className="border-t border-line-strong px-2 py-2">Total</td>
                  <td className="num border-t border-line-strong px-2 py-2 text-right">
                    {data.verticals.reduce((s, v) => s + v.invoices.length, 0)}
                  </td>
                  <td className="num border-t border-line-strong px-2 py-2 text-right">{money(data.balance, 2)}</td>
                  <td className="num border-t border-line-strong px-2 py-2 text-right">
                    {data.collected ? money(data.collected, 2) : "—"}
                  </td>
                  <td className="num border-t border-line-strong px-2 py-2 text-right">{money(data.balanceNow, 2)}</td>
                  {withBooks && (
                    <td className="num border-t border-line-strong px-2 py-2 text-right">{money(check.books, 2)}</td>
                  )}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>

      {showInvoices && data.verticals.map((v) => (
        <section key={v.verticalId}>
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 px-4 py-3 sm:px-5">
            <h3 className="text-[14px] font-semibold text-ink">{v.label}</h3>
            <span className="text-[12px] text-ink-muted">
              {v.invoices.length} invoice{v.invoices.length === 1 ? "" : "s"}
            </span>
            <span className="text-[12px] text-ink-muted">
              Balance shifted <span className="num font-medium text-ink">{money(v.balance, 2)}</span>
            </span>
            {v.collected > 0 && (
              <span className="text-[12px] text-ink-muted">
                Collected since <span className="num font-medium text-positive">{money(v.collected, 2)}</span>
              </span>
            )}
          </div>
          <div className="table-frame">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr>
                  <th className={clsx(th, "text-left")}>Invoice</th>
                  <th className={clsx(th, "text-left")}>Date</th>
                  <th className={clsx(th, "text-left")}>Due</th>
                  <th className={clsx(th, "text-left")}>Customer</th>
                  <th className={clsx(th, "text-right")}>Age (days)</th>
                  <th className={clsx(th, "text-right")}>Invoice value</th>
                  <th className={clsx(th, "text-right")}>Balance{data.asOf ? ` (${dateLabel(data.asOf)})` : ""}</th>
                  <th className={clsx(th, "text-right")}>Amount collected</th>
                  <th className={clsx(th, "text-left")}>Date of collection</th>
                  <th className={clsx(th, "text-right")}>Balance now</th>
                </tr>
              </thead>
              <tbody>
                {v.invoices.map((i) => (
                  <tr key={i.invoiceNumber} className="hover:bg-surface-sunk/40">
                    <td className={clsx(td, "whitespace-nowrap text-ink")}>{i.invoiceNumber}</td>
                    <td className={clsx(td, "whitespace-nowrap text-ink-muted")}>
                      {i.invoiceDate ? dateLabel(i.invoiceDate) : "—"}
                    </td>
                    <td className={clsx(td, "whitespace-nowrap text-ink-muted")}>
                      {i.dueDate ? dateLabel(i.dueDate) : "—"}
                    </td>
                    <td className={clsx(td, "min-w-[10rem] text-ink")}>{i.customer}</td>
                    <td className={clsx(td, "num text-right", (i.ageDays ?? 0) > 180 ? "text-caution" : "text-ink-muted")}>
                      {i.ageDays ?? "—"}
                    </td>
                    <td className={clsx(td, "num text-right text-ink-muted")}>{money(i.invoiceValue, 2)}</td>
                    <td className={clsx(td, "num text-right text-ink")}>{money(i.balance, 2)}</td>
                    <td className={clsx(td, "num text-right", i.collected ? "font-medium text-positive" : "text-ink-faint")}>
                      {i.collected ? money(i.collected, 2) : "—"}
                    </td>
                    <td className={clsx(td, "whitespace-nowrap text-ink-muted")}>
                      {i.collectedOn ? dateLabel(i.collectedOn) : "—"}
                    </td>
                    <td className={clsx(td, "num text-right text-ink")}>{money(i.balanceNow, 2)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold text-ink">
                  <td className="border-t border-line-strong px-2 py-2" colSpan={5}>
                    Total {v.label}
                  </td>
                  <td className="num border-t border-line-strong px-2 py-2 text-right">
                    {money(v.invoices.reduce((s, i) => s + i.invoiceValue, 0), 2)}
                  </td>
                  <td className="num border-t border-line-strong px-2 py-2 text-right">{money(v.balance, 2)}</td>
                  <td className="num border-t border-line-strong px-2 py-2 text-right">
                    {v.collected ? money(v.collected, 2) : "—"}
                  </td>
                  <td className="border-t border-line-strong px-2 py-2" />
                  <td className="num border-t border-line-strong px-2 py-2 text-right">{money(v.balanceNow, 2)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

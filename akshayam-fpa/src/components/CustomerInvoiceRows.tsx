import { dateLabel, money } from "@/lib/format";
import type { CustomerInvoiceRow } from "@/lib/reports/customer-trend";

const fyShortLabel = (fy: number) => `${fy}-${String(fy + 1).slice(2)}`;

/**
 * The invoices behind one customer's row, oldest first - what expanding a
 * customer reveals, wherever they appear on the page.
 */
export function CustomerInvoiceRows({
  colSpan,
  invoices,
}: {
  colSpan: number;
  invoices: CustomerInvoiceRow[];
}) {
  const total = invoices.reduce((s, inv) => s + inv.amount, 0);

  return (
    <tr>
      <td colSpan={colSpan} className="border-b border-line bg-surface-sunk/30 px-3 py-3 sm:px-6">
        {invoices.length === 0 ? (
          <p className="text-[12px] text-ink-muted">No invoices for this customer.</p>
        ) : (
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="text-ink-faint">
                <th scope="col" className="px-2 py-1 text-left font-medium">Date</th>
                <th scope="col" className="px-2 py-1 text-left font-medium">Invoice</th>
                <th scope="col" className="px-2 py-1 text-left font-medium">Year</th>
                <th scope="col" className="px-2 py-1 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={`${inv.invoiceNumber}|${inv.invoiceDate}`} className="text-ink">
                  <td className="num whitespace-nowrap border-t border-line px-2 py-1.5 text-ink-muted">
                    {dateLabel(inv.invoiceDate)}
                  </td>
                  <td className="border-t border-line px-2 py-1.5">{inv.invoiceNumber}</td>
                  <td className="border-t border-line px-2 py-1.5 text-ink-muted">
                    {fyShortLabel(inv.fy)}
                  </td>
                  <td className="num border-t border-line px-2 py-1.5 text-right font-medium">
                    {money(inv.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold text-ink">
                <td className="border-t border-line-strong px-2 py-1.5" colSpan={3}>
                  {invoices.length} invoice{invoices.length === 1 ? "" : "s"}
                </td>
                <td className="num border-t border-line-strong px-2 py-1.5 text-right">
                  {money(total)}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </td>
    </tr>
  );
}

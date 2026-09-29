"use client";

import { Fragment, useState } from "react";
import clsx from "clsx";
import { money } from "@/lib/format";
import { CustomerInvoiceRows } from "@/components/CustomerInvoiceRows";
import type { CustomerInvoiceRow, CustomerRevenueTrend } from "@/lib/reports/customer-trend";

/**
 * Customer-wise revenue, one column per financial year - the current year
 * carries a small "YTD" under its own heading, since it is not a finished
 * year the way the others are. The arrow opens that customer's own invoices,
 * across every year, right beneath their row.
 */
export function CustomerTrendTable({
  trend,
  limit,
  invoicesByCustomer,
}: {
  trend: CustomerRevenueTrend;
  /** rows shown on screen, by total revenue descending; the Excel download carries every customer */
  limit: number;
  /** pre-fetched so expanding a row is instant, not a round trip */
  invoicesByCustomer: Record<string, CustomerInvoiceRow[]>;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (customer: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(customer)) next.delete(customer);
      else next.add(customer);
      return next;
    });

  const head =
    "border-y border-line px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-faint";
  const cell = "num border-b border-line px-3 py-2 text-right";
  const shown = trend.rows.slice(0, limit);
  const colSpan = trend.years.length + 2;

  if (trend.rows.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-[13px] text-ink-muted">
        No invoices in the register yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max border-collapse text-[13px]">
        <thead>
          <tr>
            <th scope="col" className={clsx(head, "text-left")}>
              Customer
            </th>
            {trend.years.map((y) => (
              <th key={y.fy} scope="col" className={clsx(head, "text-right")}>
                {y.label}
                {y.isCurrent && (
                  <span className="mt-0.5 block text-[10px] font-normal normal-case tracking-normal text-ink-faint">
                    YTD
                  </span>
                )}
              </th>
            ))}
            <th scope="col" className={clsx(head, "border-l border-line text-right")}>
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          <tr className="bg-surface-sunk font-semibold hover:bg-surface-sunk">
            <th scope="row" className="border-b border-line px-3 py-2 text-left text-ink">
              Total
            </th>
            {trend.years.map((y) => (
              <td key={y.fy} className={clsx(cell, "text-ink")}>
                {money(trend.totalByYear[y.fy] ?? 0)}
              </td>
            ))}
            <td className={clsx(cell, "border-l border-line text-ink")}>{money(trend.grandTotal)}</td>
          </tr>
          {shown.map((row) => {
            const isOpen = open.has(row.customer);
            return (
              <Fragment key={row.customer}>
                <tr className="hover:bg-surface-sunk/50">
                  <th scope="row" className="border-b border-line px-3 py-2 text-left font-normal text-ink">
                    <button
                      type="button"
                      onClick={() => toggle(row.customer)}
                      aria-expanded={isOpen}
                      className="flex items-center gap-1.5 text-left hover:text-navy"
                    >
                      <span
                        className={clsx(
                          "text-[9px] text-ink-faint transition-transform",
                          isOpen && "rotate-90",
                        )}
                      >
                        ▶
                      </span>
                      {row.customer}
                    </button>
                  </th>
                  {trend.years.map((y) => {
                    const value = row.byYear[y.fy] ?? 0;
                    return (
                      <td key={y.fy} className={clsx(cell, "text-ink-muted")}>
                        {value === 0 ? "—" : money(value)}
                      </td>
                    );
                  })}
                  <td className={clsx(cell, "border-l border-line font-medium text-ink")}>
                    {money(row.total)}
                  </td>
                </tr>
                {isOpen && (
                  <CustomerInvoiceRows
                    colSpan={colSpan}
                    invoices={invoicesByCustomer[row.customer] ?? []}
                  />
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {trend.rows.length > limit && (
        <p className="px-3 py-3 text-[11.5px] text-ink-muted">
          The {limit} largest customers by total revenue are listed; the Excel download has all{" "}
          {trend.rows.length}.
        </p>
      )}
    </div>
  );
}

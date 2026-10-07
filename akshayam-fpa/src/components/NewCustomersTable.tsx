"use client";

import { Fragment, useState } from "react";
import clsx from "clsx";
import { CustomerInvoiceRows } from "@/components/CustomerInvoiceRows";
import { money, percent, share } from "@/lib/format";
import type { CustomerInvoiceRow, NewCustomerRow } from "@/lib/reports/customer-trend";

const COL_SPAN = 3;

/** Customers billed for the first time this year - the arrow opens their invoices in place. */
export function NewCustomersTable({
  customers,
  total,
  currentTotal,
  invoicesByCustomer,
}: {
  customers: NewCustomerRow[];
  total: number;
  /** the year's whole revenue, for each row's share */
  currentTotal: number;
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

  if (customers.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-[13px] text-ink-muted">
        No customer was billed for the first time this year.
      </p>
    );
  }

  return (
    <div className="table-frame">
      <table className="w-full min-w-max border-collapse text-[13px]">
        <thead>
          <tr>
            <th scope="col" className={clsx(head, "text-left")}>
              Customer
            </th>
            <th scope="col" className={clsx(head, "text-right")}>
              Revenue
            </th>
            <th scope="col" className={clsx(head, "text-right")}>
              % of the year
            </th>
          </tr>
        </thead>
        <tbody>
          <tr className="bg-surface-sunk font-semibold hover:bg-surface-sunk">
            <th scope="row" className="border-b border-line px-3 py-2 text-left text-ink">
              Total
            </th>
            <td className={clsx(cell, "text-ink")}>{money(total)}</td>
            <td className={clsx(cell, "text-ink")}>
              {currentTotal > 0 ? percent(share(total, currentTotal)) : "—"}
            </td>
          </tr>
          {customers.map((row) => {
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
                  <td className={clsx(cell, "text-ink")}>{money(row.amount)}</td>
                  <td className={clsx(cell, "text-ink-muted")}>
                    {currentTotal > 0 ? percent(share(row.amount, currentTotal)) : "—"}
                  </td>
                </tr>
                {isOpen && (
                  <CustomerInvoiceRows
                    colSpan={COL_SPAN}
                    invoices={invoicesByCustomer[row.customer] ?? []}
                  />
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

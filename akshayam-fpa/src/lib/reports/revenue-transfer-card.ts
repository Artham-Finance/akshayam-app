import { query } from "@/lib/db";

/**
 * The revenue-transfer-to-RBJV card on the P&L page.
 *
 * Purely informational: this list has no ledger entry behind it (see
 * 058_revenue_transfer_entries.sql), so it sits on its own between the P&L
 * and Common-size P&L rather than inside either. Its only effect elsewhere is
 * the deduction from GIFT's revenue and collection actuals in
 * src/lib/reports/budget.ts - nothing here touches the statement above it.
 */

export interface RevenueTransferCardRow {
  invoiceDate: string;
  invoiceNumber: string;
  customerName: string;
  salesperson: string | null;
  amount: number;
  status: string | null;
}

export interface RevenueTransferCardResult {
  rows: RevenueTransferCardRow[];
  total: number;
}

export async function buildRevenueTransferCard(opts: {
  entityId: number;
  start: string;
  end: string;
}): Promise<RevenueTransferCardResult> {
  const rows = await query<{
    invoice_date: string;
    invoice_number: string;
    customer_name: string;
    salesperson_name: string | null;
    amount: string;
    status: string | null;
  }>(
    `select to_char(invoice_date, 'YYYY-MM-DD') as invoice_date, invoice_number, customer_name,
            salesperson_name, amount, status
       from revenue_transfer_entries
      where entity_id = $1 and invoice_date between $2 and $3
      order by invoice_date, invoice_number`,
    [opts.entityId, opts.start, opts.end],
  );

  return {
    rows: rows.map((r) => ({
      invoiceDate: r.invoice_date,
      invoiceNumber: r.invoice_number,
      customerName: r.customer_name,
      salesperson: r.salesperson_name,
      amount: Number(r.amount),
      status: r.status,
    })),
    total: rows.reduce((s, r) => s + Number(r.amount), 0),
  };
}

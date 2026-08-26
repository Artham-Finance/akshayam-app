-- ============================================================
-- Money received but not yet applied to an invoice.
--
-- Zoho carries it on the receipt as unused_amount / bcy_unused_amount: an
-- advance, an overpayment, or a receipt banked before the invoice was raised.
-- It is part of what was collected but settles nothing, so a drill-down that
-- lists receipts against the invoices they cleared has to show it, or the
-- invoice column silently fails to add up to the amount banked.
-- ============================================================

alter table payments add column unallocated_base numeric(18,2) not null default 0;

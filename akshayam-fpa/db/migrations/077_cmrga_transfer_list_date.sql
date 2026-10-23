-- ============================================================
-- CMRGA receivables shifted to other verticals: the list date is 15-10-2026.
--
-- 076 recorded the list as at 22-10-2026, the date of the file. But the ages in it are
-- all exactly as at 15-10-2026 (due date + age = 15 Oct for every one of the 63
-- invoices), so the balances are the receivables as they stood on 15 Oct. Receipts
-- from 16 Oct to 22 Oct therefore reduced them after the list was drawn - and were not
-- counted, so the list disagreed with the receivables at the GL date (invoice
-- 2627-0269, 10,800, was paid in that window) and showed nothing collected.
--
-- The list date is the date its balances are as at. A receipt on a shifted invoice after
-- it is the collection of the vertical it was shifted to, and the amount collected and
-- its date are read from the receipts - so the list, less what has come in, is what the
-- receivables show at the GL date.
-- ============================================================

update receivable_transfers set as_of = date '2026-10-15';

-- Receipts already on the books after the list date follow their invoice; the ingest
-- applies the same rule whenever the allocations are rebuilt (each receipts upload).
update payment_allocations a
   set vertical_id = t.to_vertical_id
  from receivable_transfers t, payments p
 where t.entity_id = a.entity_id
   and t.invoice_number = a.invoice_number
   and p.id = a.payment_id
   and p.payment_date > t.as_of;

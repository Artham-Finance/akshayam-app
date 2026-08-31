-- ============================================================
-- QWAY's May-August ledger entries, completing 031_gl_qway_april_split.sql.
--
-- Confirmed: the recurring 15,000 second leg of QWAY's monthly invoice is
-- Common, not AIF, for these four months (the invoice register's own
-- salesperson text - bare "COMMON" - is correct; only the parser's refusal
-- to guess at a name-less tag needed a human decision, now given). The
-- 4 invoice_lines rows this freed from Unallocated were backfilled to
-- Common directly (not through this migration - a one-off data correction,
-- since the parser is deliberately left as-is: verticalFromSalesperson still
-- yields nothing for a future bare tag, on purpose).
--
-- The ledger's own split was never consistent for these months: May and June
-- posted the whole 30,100 to ECM (the second leg reached nowhere), July and
-- August posted the whole 30,100 to Common (ECM's own share reached
-- nowhere). Each is re-struck to ECM 15,100 / Common 15,000, the same split
-- April now carries.
-- ============================================================

update gl_entries set credit = 15100.00 where id = 8692 and vertical_id = 4 and credit = 30100.00;
insert into gl_entries (entity_id, upload_id, txn_date, account_id, vertical_id, description, txn_type, debit, credit)
select entity_id, upload_id, txn_date, account_id, 10, description, txn_type, 0, 15000.00 from gl_entries where id = 8692;

update gl_entries set credit = 15100.00 where id = 8869 and vertical_id = 4 and credit = 30100.00;
insert into gl_entries (entity_id, upload_id, txn_date, account_id, vertical_id, description, txn_type, debit, credit)
select entity_id, upload_id, txn_date, account_id, 10, description, txn_type, 0, 15000.00 from gl_entries where id = 8869;

update gl_entries set credit = 15000.00 where id = 9048 and vertical_id = 10 and credit = 30100.00;
insert into gl_entries (entity_id, upload_id, txn_date, account_id, vertical_id, description, txn_type, debit, credit)
select entity_id, upload_id, txn_date, account_id, 4, description, txn_type, 0, 15100.00 from gl_entries where id = 9048;

update gl_entries set credit = 15000.00 where id = 9232 and vertical_id = 10 and credit = 30100.00;
insert into gl_entries (entity_id, upload_id, txn_date, account_id, vertical_id, description, txn_type, debit, credit)
select entity_id, upload_id, txn_date, account_id, 4, description, txn_type, 0, 15100.00 from gl_entries where id = 9232;

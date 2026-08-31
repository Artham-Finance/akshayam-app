-- ============================================================
-- QWAY's April invoice (2627-0075, confirmed split AIF 15,000 / ECM 15,100)
-- never made it into the ledger split either: gl_entries id 8604
-- posted the whole 30,100 to ECM on 19 Apr. Same treatment as
-- 030_gl_split_invoice_reclass.sql - re-struck to the confirmed split.
--
-- QWAY's May, June, July and August entries are deliberately left alone.
-- Each month's invoice register carries the same 15,000 second leg, but with
-- salesperson text of bare "COMMON" rather than a name - vertical pair, which
-- the parser correctly leaves unresolved rather than guess at (see
-- verticalFromSalesperson in parse/sales.ts). Whether that 15,000 a month is
-- really AIF (following April) or really Common (following what the file
-- says) is a fact only the firm can confirm, not a call to make here.
-- ============================================================

update gl_entries
   set credit = 15100.00
 where id = 8604 and entity_id = 1 and vertical_id = 4 and credit = 30100.00;

insert into gl_entries (entity_id, upload_id, txn_date, account_id, vertical_id, description, txn_type, debit, credit)
select entity_id, upload_id, txn_date, account_id, 7, description, txn_type, 0, 15000.00
  from gl_entries where id = 8604;

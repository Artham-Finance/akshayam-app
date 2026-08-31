-- ============================================================
-- Two ledger entries that never caught up with the vertical splits
-- confirmed earlier this project: Tadpole (invoice 2627-0647) and Moorthy
-- Hospital (invoice 2627-0196).
--
-- Tracing the specific gl_entries rows behind each (matched by customer
-- name, date and amount - neither carries an invoice number in the GL
-- export) showed the reclass was only ever done halfway:
--
--   Tadpole: id 9004 posted the original 112,500 to DLR on 13 Jul. id 9311
--   reverses that DLR entry on 21 Jul (a credit note), and id 9109 re-posts
--   the full 112,500 to Common the same day - so DLR nets to zero and Common
--   absorbs all of it, when the confirmed split is DLR 37,500 / GADD 37,500
--   / Common 37,500 (Partner Contribution, since merged into Common).
--
--   Moorthy: id 8669 posted the full 75,000 to RRG on 17 May and nothing
--   reversed or re-posted it, when the confirmed split is RRG 25,000 / GADD
--   50,000.
--
-- Both entries are re-struck to the confirmed split rather than left as a
-- single line, so a future statement or drill-down shows one entry per
-- vertical rather than one combined figure a reader would have to divide
-- themselves.
-- ============================================================

-- Tadpole: id 9109 keeps Common's third; DLR and GADD get their own entries.
update gl_entries
   set credit = 37500.00
 where id = 9109 and entity_id = 1 and vertical_id = 10 and credit = 112500.00;

insert into gl_entries (entity_id, upload_id, txn_date, account_id, vertical_id, description, txn_type, debit, credit)
select entity_id, upload_id, txn_date, account_id, 5, description, txn_type, 0, 37500.00
  from gl_entries where id = 9109
union all
select entity_id, upload_id, txn_date, account_id, 6, description, txn_type, 0, 37500.00
  from gl_entries where id = 9109;

-- Moorthy: id 8669 keeps RRG's quarter; GADD gets its own entry.
update gl_entries
   set credit = 25000.00
 where id = 8669 and entity_id = 1 and vertical_id = 3 and credit = 75000.00;

insert into gl_entries (entity_id, upload_id, txn_date, account_id, vertical_id, description, txn_type, debit, credit)
select entity_id, upload_id, txn_date, account_id, 6, description, txn_type, 0, 50000.00
  from gl_entries where id = 8669;

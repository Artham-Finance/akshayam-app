-- ============================================================
-- RE / RI reconciliation: the vendor-bill line items behind a company's
-- reimbursable-expense account.
--
-- The General Ledger export the app already reads collapses a credit-card
-- bill's line items down to one row per vertical, so the RI number typed
-- into each line's own description at booking time - confirmed against a
-- real Zoho bill voucher - never survives into gl_entries. Zoho's own
-- item-wise Bills export does carry it, in the free-text Description
-- column, so this is a second, narrower upload: RI-tagged bill lines only,
-- not a full ledger.
--
-- The matching RI side needs no new table - it is already the
-- "Reimbursement Income" postings in gl_entries, keyed by their own
-- txn_number.
-- ============================================================

alter type upload_kind add value if not exists 'reimbursement_bills';

create table reimbursement_bill_lines (
  id            serial primary key,
  entity_id     integer not null references entities(id),
  upload_id     integer not null references uploads(id),
  bill_date     date not null,
  vendor_name   text,
  bill_number   text,
  description   text,
  customer_name text,
  vertical_id   integer references verticals(id),
  amount        numeric(14, 2) not null,
  -- Every RI-XXXX-XXXX (or RI-AKS-XXXX-XXXX) reference the line's own
  -- description carries, kept readable (upper-cased, one dash between each
  -- part) - matched against gl_entries.txn_number by stripping punctuation
  -- from both sides at query time, not by how it is stored here. Empty when
  -- the line was booked to the reimbursement account but no RI number was
  -- typed - a worklist in its own right.
  ri_references text[] not null default '{}'
);

create index reimbursement_bill_lines_entity_date_idx
  on reimbursement_bill_lines (entity_id, bill_date);

create index reimbursement_bill_lines_refs_idx
  on reimbursement_bill_lines using gin (ri_references);

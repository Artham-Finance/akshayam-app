-- ============================================================
-- RE / RI reconciliation: net-banking-paid reimbursable expense.
--
-- The General Ledger export the app already reads has nothing to extract for
-- these - just the bank account's own name in the description, confirmed
-- against a real posting - so they have sat outside the reconciliation
-- entirely (see reimbursement_bill_lines.sql for the same gap on the bill
-- side, and reimbursement-reco.ts's own docstring for why). Zoho's Account
-- Transactions export for the reimbursement expense account carries the RI
-- number instead, in its own Reference Number column, for entries booked
-- straight against the bank (transaction_type "expense") - confirmed against
-- RBJV's real ledger. Bill and petty-cash-journal lines are already read
-- elsewhere (the item-wise Bills upload, and gl_entries directly), so only
-- the bank-paid rows from this export are worth a table of their own.
-- ============================================================

alter type upload_kind add value if not exists 'reimbursement_expense_txns';

create table reimbursement_expense_lines (
  id            serial primary key,
  entity_id     integer not null references entities(id),
  upload_id     integer not null references uploads(id),
  txn_date      date not null,
  description   text,
  reference     text,
  amount        numeric(14, 2) not null,
  -- Same shape and the same matching rule as reimbursement_bill_lines.ri_references.
  ri_references text[] not null default '{}'
);

create index reimbursement_expense_lines_entity_date_idx
  on reimbursement_expense_lines (entity_id, txn_date);

create index reimbursement_expense_lines_refs_idx
  on reimbursement_expense_lines using gin (ri_references);

-- ============================================================
-- The credit-note register, kept separate from the deduction it produces.
--
-- Same move as 033 did for invoices: the Credit Note Details export lands here
-- verbatim, and credit_notes (what the revenue queries read) is rebuilt as a
-- projection of the ledger's own creditnote postings on revenue and
-- reimbursement accounts - the ledger's rupee amount, its reporting tag, split
-- across tags where the ledger split it - joined back here for the currency,
-- customer and applied-invoice number the ledger does not carry.
--
-- The Credit Note Details export and the ledger's creditnote postings had been
-- disagreeing by a small amount, which left the Revenue "By vertical" Net out
-- against the P&L by exactly that. Driving both from the ledger closes it.
--
-- A credit note the ledger never posted (a draft) simply never reaches
-- credit_notes, so it deducts from nothing - the same rule invoices follow.
-- ============================================================

create table if not exists credit_note_register (
  id                 bigserial primary key,
  entity_id          int  not null references entities(id) on delete cascade,
  upload_id          int  not null references uploads(id)  on delete cascade,
  credit_note_number text not null,
  credit_note_date   date not null,
  customer_name      text not null,
  vertical_hint      int  references verticals(id),
  status             text,
  currency           text not null default 'INR',
  exchange_rate      numeric(18,6) not null default 1,
  cn_amount_base     numeric(18,2) not null default 0,
  cn_total_base      numeric(18,2) not null default 0,
  invoice_number     text,
  is_primary_row     boolean not null default true,
  is_reimbursement   boolean not null default false
);
create index cn_register_number_idx on credit_note_register (entity_id, credit_note_number);
create index cn_register_date_idx   on credit_note_register (entity_id, credit_note_date);

comment on table credit_note_register is
  'Credit Note Details export, verbatim. credit_notes is a ledger-driven projection of this; nothing reads this table for a reported figure.';

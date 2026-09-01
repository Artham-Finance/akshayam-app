-- ============================================================
-- The invoice register, kept separate from the revenue it produces.
--
-- The Invoice Details export carries a salesperson, which resolves to exactly
-- one vertical per invoice. The general ledger carries a reporting tag on every
-- revenue posting, and a single invoice's revenue can be split across two or
-- three tags. Where the two disagree the ledger is right - it is the same
-- source the P&L is built from - so revenue must follow the ledger, not the
-- salesperson.
--
-- So the raw export lands here verbatim, and invoice_lines (the thing every
-- revenue, collection and receivables query already reads) is rebuilt as a
-- projection of the ledger's revenue and reimbursement postings, enriched with
-- the currency, customer and salesperson this table holds. An invoice with no
-- ledger posting is a draft, not revenue, and simply never reaches
-- invoice_lines - it is still visible here for the "not in the ledger" notice.
--
-- vertical_hint is the old salesperson-derived guess, kept for diagnostics
-- only; nothing reads it for a figure.
-- ============================================================

create table if not exists invoice_register (
  id               bigserial primary key,
  entity_id        int  not null references entities(id) on delete cascade,
  upload_id        int  not null references uploads(id)  on delete cascade,
  invoice_number   text not null,
  invoice_date     date not null,
  due_date         date,
  customer_name    text not null,
  vertical_hint    int  references verticals(id),
  salesperson      text,
  item_name        text,
  currency         text not null default 'INR',
  exchange_rate    numeric(18,6) not null default 1,
  amount_base      numeric(18,2) not null default 0,   -- ex-tax, INR
  total_base       numeric(18,2) not null default 0,   -- incl. tax, INR
  status           text,
  is_reimbursement boolean not null default false
);
create index invoice_register_number_idx on invoice_register (entity_id, invoice_number);
create index invoice_register_date_idx   on invoice_register (entity_id, invoice_date);

comment on table invoice_register is
  'Invoice Details export, verbatim. invoice_lines is a ledger-driven projection of this; nothing reads this table for a reported figure except the "invoices not in the ledger" notice.';
comment on column invoice_register.vertical_hint is
  'Salesperson-derived vertical guess, kept for diagnostics. The reported vertical comes from the ledger tag, not from here.';

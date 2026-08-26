-- ============================================================
-- Credit notes, and the reimbursement split on collections.
--
-- Credit notes reduce ledger revenue but do not appear in the Invoice Details
-- export, which is why invoiced revenue read ~19.65 lakh higher than the P&L.
--
-- One credit note can be applied against several invoices, so the export
-- repeats the credit note on a row per applied invoice. cn_amount_base is
-- therefore the credit note's own value and repeats across those rows - it is
-- counted once per creditnote_number, never summed across rows.
-- ============================================================

alter type upload_kind add value if not exists 'credit_notes';

create table credit_notes (
  id                bigserial primary key,
  entity_id         int  not null references entities(id) on delete cascade,
  upload_id         int  not null references uploads(id)  on delete cascade,
  credit_note_number text not null,
  credit_note_date  date not null,
  customer_name     text not null,
  vertical_id       int  references verticals(id),
  status            text,
  currency          text not null default 'INR',
  exchange_rate     numeric(18,6) not null default 1,
  -- the credit note's own value, repeated on every applied-invoice row
  cn_amount_base    numeric(18,2) not null default 0,
  cn_total_base     numeric(18,2) not null default 0,
  -- the invoice this row applies the credit note against, when stated
  invoice_number    text,
  /* true when this is the first row for its credit note, so summing this
     flag's rows gives the credit note total without double counting */
  is_primary_row    boolean not null default true
);
create index cn_date_idx     on credit_notes (entity_id, credit_note_date);
create index cn_customer_idx on credit_notes (entity_id, customer_name);
create index cn_invoice_idx  on credit_notes (entity_id, invoice_number);

-- Reimbursement invoices are raised to recover MCA filing fees paid on the
-- firm's card. The client needs collections split between those and fee
-- invoices, so the flag is stored rather than re-derived at every query.
alter table invoice_lines add column is_reimbursement boolean not null default false;
alter table payments     add column is_reimbursement boolean not null default false;

comment on column invoice_lines.is_reimbursement is
  'Reimbursement invoice (RI- prefix): a recharge of client-paid costs, not fee income.';
comment on column payments.is_reimbursement is
  'Collection against a reimbursement invoice rather than a fee invoice.';

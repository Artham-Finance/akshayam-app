-- ============================================================
-- MAK meeting - TDS receivables, invoice wise by quarter: what the vertical's
-- head writes against an invoice's TDS - an observation, and the follow-up action.
--
-- The invoice, its TDS and the Form 26AS figure are read from the ledger, the
-- invoice register and Form 26AS each time the tab opens (see
-- src/lib/reports/tds-receivables.ts); only these two free-text notes are kept.
-- A note belongs to an invoice of a customer in a financial-year quarter - the
-- quarter the TDS was booked in, the one Form 26AS is struck for. A TDS posting that
-- names no invoice is kept under an empty invoice number. An invoice carrying TDS for two
-- verticals is two rows, each with its own notes; vertical_id 0 is no vertical.
-- ============================================================

create table tds_invoice_notes (
  id             serial primary key,
  entity_id      integer not null references entities(id),
  fy_start_year  integer not null,
  quarter        integer not null check (quarter between 1 and 4),
  customer       text    not null,
  invoice_number text    not null default '',
  vertical_id    integer not null default 0,
  observation    text,
  follow_up      text,
  updated_by     integer references users(id),
  updated_at     timestamptz not null default now(),
  unique (entity_id, fy_start_year, quarter, customer, invoice_number, vertical_id)
);

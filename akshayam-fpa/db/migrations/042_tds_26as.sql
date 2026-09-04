-- ============================================================
-- Form 26AS (Form 168) TDS credits, and the reconciliation against the books.
--
-- The statement is the income tax department's record of what customers
-- deducted and deposited against the firm's PAN. The books record the same
-- thing from the other side: a TDS receivable is raised when an invoice is
-- approved, either in the general "TDS Receivable" ledger or in a
-- customer-specific one named "TDS-2627-<CUSTOMER>".
--
-- The two disagree for reasons that matter commercially - a customer deducted
-- but never deposited, deducted at the wrong rate, or the firm booked a credit
-- the department has no record of - so the difference is the point of the
-- report, not an error to be smoothed over.
--
-- Deductor names come from the deductor's own TDS return and rarely match the
-- customer name in Zoho ("RAM NATH AND CO PRIVATE LIMITED" against "Ram Nath &
-- Co Pvt Ltd"). Matching is by normalised name, with an alias table for the
-- ones that cannot be matched mechanically - the same shape as the vertical
-- aliases, and for the same reason: a wrong guess is worse than an open
-- question.
-- ============================================================

alter type upload_kind add value if not exists 'tds_26as';

create table tds_entries (
  id               bigserial primary key,
  entity_id        int  not null references entities(id) on delete cascade,
  upload_id        int  not null references uploads(id)  on delete cascade,

  deductor_name    text not null,
  tan              text,
  deductor_pan     text,

  section          text,
  transaction_date date,
  booking_status   text,          -- Final / Overbooked / Unmatched / Provisional
  booking_date     date,

  amount_credited  numeric(18,2) not null default 0,
  tax_deducted     numeric(18,2) not null default 0,
  tds_deposited    numeric(18,2) not null default 0,

  tax_year         text,          -- "2026-27"
  updated_till     date,          -- how current the statement was when downloaded

  -- Resolved against the sales ledger. Null means the deductor could not be
  -- matched to a customer and is shown as unmatched rather than dropped.
  customer_name    text,
  vertical_id      int references verticals(id)
);

create index tds_entity_date_idx on tds_entries (entity_id, transaction_date);
create index tds_customer_idx    on tds_entries (entity_id, customer_name);
create index tds_deductor_idx    on tds_entries (entity_id, deductor_name);
create index tds_vertical_idx    on tds_entries (entity_id, vertical_id);

-- Manual deductor -> customer mapping, for names normalisation cannot join.
create table tds_deductor_aliases (
  id            serial primary key,
  entity_id     int  not null references entities(id) on delete cascade,
  -- normalised deductor name, or a TAN when the name is unusable
  deductor_key  text not null,
  customer_name text not null,
  created_at    timestamptz not null default now(),
  unique (entity_id, deductor_key)
);

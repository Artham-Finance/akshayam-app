-- ============================================================
-- Splitting a receipt across the invoices it settles.
--
-- Zoho records one payment row per receipt, with the invoices it clears as a
-- comma-separated list ("2627-0636,2627-0497,2627-0498") and a single total.
-- There is no per-invoice applied amount in the export.
--
-- Matching the whole string against one invoice fails for those receipts, which
-- left ~60 lakh unattributed and - worse - mis-stated the reimbursement split,
-- because a receipt covering both a fee invoice and an RI invoice was counted
-- entirely as one or the other.
--
-- Each receipt is therefore broken into one allocation row per invoice:
--   pro_rata   every referenced invoice is in the register, so the receipt is
--              split in proportion to invoice value - the defensible basis
--   equal      at least one invoice is unknown, so value weighting is not
--              possible and the receipt is divided evenly
--   single     one invoice, no split needed
--   unmatched  no invoice number on the receipt at all
-- The basis is stored so any figure can be traced back to how it was derived.
-- ============================================================

create table payment_allocations (
  id               bigserial primary key,
  entity_id        int    not null references entities(id) on delete cascade,
  payment_id       bigint not null references payments(id) on delete cascade,
  invoice_number   text,
  vertical_id      int    references verticals(id),
  is_reimbursement boolean not null default false,
  amount_base      numeric(18,2) not null default 0,
  basis            text   not null
);

create index pa_entity_idx   on payment_allocations (entity_id);
create index pa_payment_idx  on payment_allocations (payment_id);
create index pa_vertical_idx on payment_allocations (entity_id, vertical_id);

-- ============================================================
-- Recurring retainership revenue, by customer and month.
--
-- The firm bills two kinds of work: one-off professional engagements, and a
-- monthly retainer that recurs whether or not anything happened that month.
-- They are managed differently and a vertical carrying 80% retainer is a very
-- different business from one carrying none, so the revenue summary splits
-- them.
--
-- Only the retainer half is stored. Professional fee is the remainder of
-- ledger revenue, which keeps the two adding up to the P&L exactly rather than
-- to each other approximately - and means a retainer figure that is slightly
-- off shifts the split without ever changing the total.
-- ============================================================

create table retainer_revenue (
  id            bigserial primary key,
  entity_id     int  not null references entities(id) on delete cascade,
  upload_id     int  references uploads(id) on delete cascade,
  -- first day of the month the retainer belongs to
  month         date not null,
  customer_name text not null,
  customer_ref  text,
  vertical_id   int  references verticals(id),
  amount_base   numeric(18,2) not null default 0,
  unique (entity_id, month, customer_name)
);

create index retainer_month_idx    on retainer_revenue (entity_id, month);
create index retainer_vertical_idx on retainer_revenue (entity_id, vertical_id, month);

alter type upload_kind add value if not exists 'retainers';

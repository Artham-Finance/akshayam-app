-- ============================================================
-- Remarks on the TDS reconciliation, one per customer per quarter.
--
-- A customer whose Form 26AS carries a deduction the books never raised
-- (ret_only) has no invoice to point a reader at - the only trace of why is
-- whatever someone who looked into it writes down. Kept at (entity, FY,
-- quarter, customer), the same grain byCustomer is struck at, so a remark
-- reads against the very row it explains regardless of segment.
-- ============================================================

create table tds_remarks (
  id              serial primary key,
  entity_id       integer not null references entities(id),
  fy_start_year   integer not null,
  quarter         smallint not null check (quarter between 1 and 4),
  customer        text not null,
  remark          text not null,
  updated_at      timestamptz not null default now()
);

create unique index tds_remarks_key
  on tds_remarks (entity_id, fy_start_year, quarter, customer);

-- ============================================================
-- DSC token stock-take, book against physical.
--
-- The DSC and support vertical buys and sells digital-signature tokens. The
-- "DSC Asset Token" account (a current asset) carries their value in the books;
-- the count in hand is verified against it at each month end.
--
-- Book value is read from the ledger - the account balance as at the month
-- end. Everything else is keyed in on the Receivables page, once a month:
--
--   book_qty        how many tokens the books say are in hand
--   physical_qty    how many were actually counted
--   physical_value  what that count is worth
--
-- One row per month per vertical (DSC), so a recount overwrites rather than
-- stacking.
-- ============================================================

create table dsc_token_count (
  id             serial primary key,
  entity_id      int  not null references entities(id) on delete cascade,
  vertical_id    int  not null references verticals(id) on delete cascade,
  -- first day of the month the count is for
  month          date not null,
  book_qty       numeric(18,2) not null default 0,
  physical_qty   numeric(18,2) not null default 0,
  physical_value numeric(18,2) not null default 0,
  updated_at     timestamptz not null default now(),
  unique (entity_id, vertical_id, month)
);

create index dsc_token_count_lookup_idx
  on dsc_token_count (entity_id, vertical_id, month);

-- ============================================================
-- What was actually spent under each Other-expenses line.
--
-- 016 recorded a single corrected figure per line per month, over a figure
-- read from the ledger. In use that turned out to be the wrong shape: the
-- ledger's account names do not line up with the budget's heads closely enough
-- to be trusted, and a single number carries no record of what it was made of.
--
-- A line's actual is therefore entered, not derived - one row per bill, with
-- the date it was spent, who it was paid to, and why where that needs saying.
-- The line's actual is the sum of its rows, so the detail is the figure rather
-- than an explanation attached to one.
--
-- The overrides table is dropped rather than migrated: it never carried a row.
-- ============================================================

drop table if exists expense_actual_overrides;

create table expense_entries (
  id            serial primary key,
  entity_id     int  not null references entities(id) on delete cascade,
  fy_start_year int  not null,
  -- the budget line this belongs to, as held in expense_budget_lines
  head          text not null,
  label         text not null,
  -- first day of the month the cost is reported in, derived from spent_on but
  -- stored so a bill can be reported in a month other than the one it is dated
  month         date not null,
  spent_on      date not null,
  vendor        text,
  amount        numeric(18,2) not null,
  remark        text,
  created_at    timestamptz not null default now()
);

create index expense_entries_lookup_idx
  on expense_entries (entity_id, fy_start_year, month);

create index expense_entries_line_idx
  on expense_entries (entity_id, fy_start_year, head, label, month);

-- Vendors already used, for the suggestion list on the entry form.
create index expense_entries_vendor_idx on expense_entries (entity_id, vendor);

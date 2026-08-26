-- ============================================================
-- The budgeted P&L, by month and reporting line.
--
-- budgets (010) holds revenue and collection targets per vertical, which is
-- what the revenue and collections pages measure against. This is the other
-- half: the whole statement, month by month, so budget-versus-actual can be
-- read down the P&L rather than only across the top line.
--
-- Stored against the same group codes the actual statement uses, so the two
-- sides of every line are the same definition by construction. Subtotals are
-- not stored - EBITDA, PBT, PAT and retained profit are computed from the
-- lines, exactly as they are for the actual, so the budget column can never
-- add up differently from the actual column beside it.
-- ============================================================

create table budget_pnl (
  id            serial primary key,
  entity_id     int  not null references entities(id) on delete cascade,
  fy_start_year int  not null,
  -- first day of the month
  month         date not null,
  -- report_groups.code for the 'pnl' statement
  group_code    text not null,
  amount        numeric(18,2) not null default 0,
  unique (entity_id, fy_start_year, month, group_code)
);

create index budget_pnl_lookup_idx on budget_pnl (entity_id, fy_start_year, month);

-- ---------- head count, for cost apportionment ----------

-- The budget apportions common cost partly on head count, so the count is part
-- of the budget and belongs beside it rather than in a spreadsheet nobody can
-- see from here.
create table vertical_headcount (
  id            serial primary key,
  vertical_id   int  not null references verticals(id) on delete cascade,
  fy_start_year int  not null,
  heads         int  not null default 0,
  unique (vertical_id, fy_start_year)
);

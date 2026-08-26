-- ============================================================
-- The breakdown behind "Other expenses".
--
-- budget_pnl (013) carries Other expenses as one figure a month, which is the
-- right altitude for a statement but not for the line the founder actually
-- watches. The budget workbook breaks it into heads, and two of those heads
-- into sub-lines; this holds that breakdown so the same detail can be read in
-- the app instead of in the workbook.
--
-- The sum of these lines for a month is the same figure budget_pnl holds for
-- 'overheads' that month. Nothing recomputes the statement from here - this is
-- detail beneath a total that is already struck, and the report says so when
-- the two disagree.
-- ============================================================

create table expense_budget_lines (
  id            serial primary key,
  entity_id     int  not null references entities(id) on delete cascade,
  fy_start_year int  not null,
  -- the budget's own head of cost: 'Other Expenses', 'Staff Welfare', ...
  head          text not null,
  -- the sub-line, or the head repeated where it has no breakdown
  label         text not null,
  -- first day of the month
  month         date not null,
  amount        numeric(18,2) not null default 0,
  sort_order    int  not null default 0,
  unique (entity_id, fy_start_year, head, label, month)
);

create index expense_budget_lines_lookup_idx
  on expense_budget_lines (entity_id, fy_start_year, month);

-- ---------- the actual, corrected by hand ----------

-- What the ledger posted is the starting point, matched to these lines by
-- account. It does not always agree with the budget's own idea of a line: a
-- bill lands a month late, petrol is treated as staff welfare, a cost is
-- reclassified after the fact. The Excel this replaces carried a Remarks
-- column for exactly that, so the correction and its reason are kept together
-- here rather than one being written down without the other.
--
-- amount null means "the ledger figure is right" - the row then exists only to
-- carry its remark.
create table expense_actual_overrides (
  id            serial primary key,
  entity_id     int  not null references entities(id) on delete cascade,
  fy_start_year int  not null,
  head          text not null,
  label         text not null,
  month         date not null,
  amount        numeric(18,2),
  remark        text,
  updated_at    timestamptz not null default now(),
  unique (entity_id, fy_start_year, head, label, month)
);

create index expense_actual_overrides_lookup_idx
  on expense_actual_overrides (entity_id, fy_start_year, month);

-- ============================================================
-- Team cost, captured by vertical and by role.
--
-- budget_pnl (013) carries "Team cost" (the direct_cost group) as one company
-- figure a month - the right altitude for the statement, but not for the
-- question the partners ask about it: which vertical is carrying the cost, and
-- is it the team lead, the salaried staff or the trainees.
--
-- The general ledger has no such split - a direct-cost account is "Consultancy
-- charges" or "Staff salary", not "GIFT / trainee" - so this is entered by
-- hand. It is the same shape as the Other-expenses breakdown beside it on the
-- Budget vs Actual page: detail beneath a total already struck, and the page
-- says so where the two do not tie.
--
--   role: 'team_lead'  consultant fee
--         'employee'   salary
--         'trainee'    stipend
--
-- The budget is one annual figure per vertical x role; the period column on
-- screen is that figure pro-rated to the months being shown. The actual is
-- entered a month at a time, so a part-year comparison has something real to
-- sit against.
-- ============================================================

create table team_cost_budget (
  id            serial primary key,
  entity_id     int  not null references entities(id) on delete cascade,
  fy_start_year int  not null,
  vertical_id   int  not null references verticals(id) on delete cascade,
  role          text not null check (role in ('team_lead', 'employee', 'trainee')),
  annual_budget numeric(18,2) not null default 0,
  updated_at    timestamptz not null default now(),
  unique (entity_id, fy_start_year, vertical_id, role)
);

create index team_cost_budget_lookup_idx
  on team_cost_budget (entity_id, fy_start_year);

create table team_cost_actual (
  id            serial primary key,
  entity_id     int  not null references entities(id) on delete cascade,
  fy_start_year int  not null,
  vertical_id   int  not null references verticals(id) on delete cascade,
  role          text not null check (role in ('team_lead', 'employee', 'trainee')),
  -- first day of the month the cost is reported in
  month         date not null,
  amount        numeric(18,2) not null default 0,
  updated_at    timestamptz not null default now(),
  unique (entity_id, fy_start_year, vertical_id, role, month)
);

create index team_cost_actual_lookup_idx
  on team_cost_actual (entity_id, fy_start_year, month);

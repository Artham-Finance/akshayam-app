-- ============================================================
-- Manually keyed actual for "Common cost apportionment", Akshayam.
--
-- Akshayam's budget carries a share of RBJV's common cost, apportioned onto
-- it on revenue, on head count and by equal distribution (see "4 - Akshayam
-- Monthly", the three "Common Cost Allocation" sub-rows, now parsed to their
-- own group_code rather than folded into Other expenses). Nothing books this
-- as an actual cost in Zoho, so there is no ledger figure to read - the
-- actual is keyed in by hand instead, same shape as company_headcount and
-- vertical_headcount: month is null for the annual baseline, set for that
-- month's own figure. Until someone keys one in, the actual reads nil.
-- ============================================================

create table common_cost_apportionment_actual (
  id            serial primary key,
  entity_id     int  not null references entities(id) on delete cascade,
  fy_start_year int  not null,
  month         date,
  amount        numeric(18,2) not null default 0
);

-- One row per company per month, and one annual baseline per company.
-- `unique nulls not distinct` would say this in one constraint, but that is
-- PostgreSQL 15 and production is on 14 - so two partial indexes, as in
-- 054_monthly_headcount.
create unique index common_cost_apportionment_actual_entity_fy_month_key
  on common_cost_apportionment_actual (entity_id, fy_start_year, month)
  where month is not null;

create unique index common_cost_apportionment_actual_entity_fy_annual_key
  on common_cost_apportionment_actual (entity_id, fy_start_year)
  where month is null;

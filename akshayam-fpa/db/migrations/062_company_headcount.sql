-- ============================================================
-- Total head count for the company as a whole, month by month.
--
-- The "company-wide head count" comparison card needs a real denominator -
-- every person in the company, not just the six revenue-generating
-- verticals it apportions across. Summing vertical_headcount only covers
-- verticals that happen to carry a monthly figure (the six, plus ACC and
-- HRCM and whichever others were seeded) - it silently misses anyone in
-- Common, DSC, or any other cost centre never given its own head-count
-- row. So this is kept and keyed in directly, the same shape as
-- vertical_headcount: month is null for the annual baseline, set for that
-- month's own figure.
-- ============================================================

create table company_headcount (
  id            serial primary key,
  entity_id     int  not null references entities(id) on delete cascade,
  fy_start_year int  not null,
  month         date,
  heads         int  not null default 0
);

-- One row per company per month, and one annual baseline per company.
-- `unique nulls not distinct` would say this in one constraint, but that is
-- PostgreSQL 15 and production is on 14 - so two partial indexes, as in
-- 054_monthly_headcount.
create unique index company_headcount_entity_fy_month_key
  on company_headcount (entity_id, fy_start_year, month)
  where month is not null;

create unique index company_headcount_entity_fy_annual_key
  on company_headcount (entity_id, fy_start_year)
  where month is null;

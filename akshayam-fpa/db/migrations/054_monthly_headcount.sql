-- ============================================================
-- Monthly head count, so cost apportionment follows trainee rotation.
--
-- RBJV rotates a handful of trainees between verticals month to month. Head
-- count drives four of the apportioned pool heads (Office expenses, Staff
-- welfare, Communication, Other expenses), and a single annual figure per
-- vertical kept charging the wrong one whenever a trainee moved.
--
-- vertical_headcount gains a `month` column:
--   month is null  -> the annual baseline (meaning unchanged; still used where
--                     no month-specific row exists, e.g. Akshayam / GIFT)
--   month set      -> that month's head count for the vertical
--
-- buildApportionment averages coalesce(monthly, annual) over the months in the
-- window it is struck for, so a trainee who spent one of a quarter's three
-- months in a vertical adds about a third of a head to it for that quarter.
--
-- Seeded here: RBJV's nine verticals get twelve monthly rows each, every month
-- equal to the current annual figure - so nothing moves until a real rotation
-- is entered. Rotation changes are applied by later migrations, e.g.
--   update vertical_headcount set heads = 2
--    where vertical_id = (select id from verticals where entity_id = 1 and code = 'ECM')
--      and fy_start_year = 2026 and month = '2026-07-01';
-- (and the matching +1 on the vertical the trainee moved to).
-- ============================================================

alter table vertical_headcount add column month date;

alter table vertical_headcount
  drop constraint vertical_headcount_vertical_id_fy_start_year_key;

-- One row per vertical per month, and still one annual baseline per vertical.
-- A plain unique (vertical_id, fy_start_year, month) would not give the second
-- of those: null months never collide, so a vertical could collect any number
-- of annual rows. `unique nulls not distinct` says it in a single constraint,
-- but that is PostgreSQL 15 and production is on 14 - so two partial indexes,
-- which mean the same thing on both.
create unique index vertical_headcount_vertical_fy_month_key
  on vertical_headcount (vertical_id, fy_start_year, month)
  where month is not null;

create unique index vertical_headcount_vertical_fy_annual_key
  on vertical_headcount (vertical_id, fy_start_year)
  where month is null;

-- RBJV: twelve monthly rows per vertical, seeded from the annual baseline.
insert into vertical_headcount (vertical_id, fy_start_year, month, heads)
select h.vertical_id,
       h.fy_start_year,
       (date '2026-04-01' + (n || ' months')::interval)::date as month,
       h.heads
  from vertical_headcount h
  join verticals v on v.id = h.vertical_id
  join entities e on e.id = v.entity_id
  cross join generate_series(0, 11) as n
 where e.slug = 'rbjv' and h.fy_start_year = 2026 and h.month is null
on conflict (vertical_id, fy_start_year, month) where month is not null do nothing;

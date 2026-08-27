-- ============================================================
-- The two vertical budgets a fresh deployment came up without.
--
-- 010_budgets seeds each vertical's revenue and collection target by joining
-- the budget figures to `verticals` on the vertical code. That works only for
-- verticals 002_seed created - and 002 seeds RBJV's ten. GIFT (Akshayam) and
-- HRCM (RBJV) are not among them: they come into existence when a file tagged
-- with them is first uploaded.
--
-- On this laptop the migrations were re-run a day after the first uploads, so
-- both verticals already existed and the join found them. On a fresh install
-- every migration runs in one pass against an empty database, 010 runs
-- seconds after 002, and the join matches nothing - so Akshayam showed an
-- annual budget of zero and RBJV was quietly 24 lakh light.
--
-- A seed that depends on data an upload happens to have created already is
-- not a seed, so this one creates the vertical if it is absent and is safe to
-- run against a database that already has the rows.
-- ============================================================

-- ---------- the two verticals, if they are not there yet ----------

insert into verticals (entity_id, code, name, sort_order)
select e.id, v.code, v.name, v.sort_order
  from entities e
  join (values
    ('rbjv',     'HRCM', 'HR Compliance Management', 85),
    ('akshayam', 'GIFT', 'GIFT and Support',         10)
  ) as v(slug, code, name, sort_order) on v.slug = e.slug
 where not exists (
         select 1 from verticals x where x.entity_id = e.id and x.code = v.code);

-- ---------- their budgets, FY 2026-27 ----------

insert into budgets (entity_id, vertical_id, fy_start_year, measure, annual_amount,
                     display_name, sort_order)
select e.id, v.id, 2026, m.measure,
       case m.measure when 'collection' then b.collection else b.revenue end,
       b.display_name, b.sort_order
  from entities e
  join verticals v on v.entity_id = e.id
  join (values
    ('rbjv',     'HRCM', 2592000,  2400000,  'Mahalakshmi.R - HR Compliance Management',  60),
    ('akshayam', 'GIFT', 13500000, 12500000, 'Raja - GIFT and Support',                  120)
  ) as b(slug, code, collection, revenue, display_name, sort_order)
    on b.slug = e.slug and b.code = v.code
 cross join (values ('revenue'), ('collection')) as m(measure)
    on conflict (entity_id, vertical_id, fy_start_year, measure) do nothing;

-- 015_budget_order set the running order by the same join and missed these two
-- for the same reason, leaving them at the default 999 - below every line the
-- partners read down.
update budgets b
   set sort_order = o.rank
  from (values ('rbjv', 'HRCM', 60), ('akshayam', 'GIFT', 120)) as o(slug, code, rank)
  join verticals v on v.code = o.code
  join entities e on e.id = v.entity_id and e.slug = o.slug
 where b.vertical_id = v.id and b.sort_order = 999;

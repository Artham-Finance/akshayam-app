-- ============================================================
-- Re-seed the two "created on first upload" vertical budgets - Akshayam's GIFT
-- and RBJV's HRCM - for deployments where 021 did not take.
--
-- 010_budgets joins the budget figures to `verticals` by code, and 002 seeds
-- only RBJV's ten. GIFT and HRCM come into being when a tagged file is first
-- uploaded, which on a one-pass install is long after 010 has run and found
-- nothing - so those two lines show an annual budget of zero. 021 was written
-- to patch exactly this, but the live deployment still shows Akshayam's
-- Revenue and Collections budget as zero, so 021 evidently never applied there.
--
-- This is 021's body, re-issued as its own migration: create each vertical
-- only if it is genuinely absent, then upsert its FY 2026-27 revenue and
-- collection budget. `on conflict do nothing` makes it a no-op wherever the
-- rows already exist.
-- ============================================================

insert into verticals (entity_id, code, name, sort_order)
select e.id, v.code, v.name, v.sort_order
  from entities e
  join (values
    ('rbjv',     'HRCM', 'HR Compliance Management', 85),
    ('akshayam', 'GIFT', 'GIFT and Support',         10)
  ) as v(slug, code, name, sort_order) on v.slug = e.slug
 where not exists (
         select 1 from verticals x where x.entity_id = e.id and x.code = v.code);

insert into budgets (entity_id, vertical_id, fy_start_year, measure, annual_amount,
                     display_name, sort_order)
select e.id, v.id, 2026, m.measure,
       case m.measure when 'collection' then b.collection else b.revenue end,
       b.display_name, b.sort_order
  from entities e
  join verticals v on v.entity_id = e.id
  join (values
    ('rbjv',     'HRCM', 2592000,  2400000,  'Mahalakshmi.R - HR Compliance Management', 60),
    ('akshayam', 'GIFT', 13500000, 12500000, 'Raja - GIFT and Support',                  120)
  ) as b(slug, code, collection, revenue, display_name, sort_order)
    on b.slug = e.slug and b.code = v.code
 cross join (values ('revenue'), ('collection')) as m(measure)
    on conflict (entity_id, vertical_id, fy_start_year, measure) do nothing;

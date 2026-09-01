-- ============================================================
-- FY 2026-27 budget revisions, confirmed by the partners:
--
--   * Common (also partners contribution) incl other services is cut to
--     25,00,000 revenue / 27,00,000 collection (was 50,00,000 / 54,00,000).
--   * A new line, "Jayanth IPO", is added at 25,00,000 revenue /
--     27,00,000 collection.
--
-- Both are RBJV lines. The consolidated group reads one line per vertical
-- code across its members (entity_members {1,2}), so changing RBJV's rows is
-- what the Group (consolidated) view shows too - it holds no budget of its
-- own.
--
-- Idempotent: the update sets a fixed figure, the vertical is created only if
-- absent, and the new budget rows upsert.
-- ============================================================

-- ---------- Common: revised down ----------

update budgets b
   set annual_amount = case m.measure when 'revenue' then 2500000 else 2700000 end
  from entities e
  join verticals v on v.entity_id = e.id and v.code = 'COMMON'
 cross join (values ('revenue'), ('collection')) as m(measure)
 where e.slug = 'rbjv'
   and b.entity_id = e.id and b.vertical_id = v.id
   and b.fy_start_year = 2026 and b.measure = m.measure;

-- ---------- Jayanth IPO: new vertical ----------

insert into verticals (entity_id, code, name, sort_order)
select e.id, 'JIPO', 'Jayanth IPO', 110
  from entities e
 where e.slug = 'rbjv'
   and not exists (
     select 1 from verticals x where x.entity_id = e.id and x.code = 'JIPO');

-- ---------- Jayanth IPO: its budgets ----------

insert into budgets (entity_id, vertical_id, fy_start_year, measure, annual_amount,
                     display_name, sort_order)
select e.id, v.id, 2026, m.measure,
       case m.measure when 'revenue' then 2500000 else 2700000 end,
       'Jayanth IPO', 110
  from entities e
  join verticals v on v.entity_id = e.id and v.code = 'JIPO'
 cross join (values ('revenue'), ('collection')) as m(measure)
 where e.slug = 'rbjv'
    on conflict (entity_id, vertical_id, fy_start_year, measure)
    do update set annual_amount = excluded.annual_amount,
                  display_name  = excluded.display_name,
                  sort_order    = excluded.sort_order;

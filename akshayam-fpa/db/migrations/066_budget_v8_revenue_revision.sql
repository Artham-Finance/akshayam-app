-- ============================================================
-- FY 2026-27 revenue budget, revised per PL_Vertical_Budget_FY2627_LATEST_V8:
--
--   Vijay (DLR)          2,00,00,000  unchanged
--   Rekha (CFC)          1,10,00,000 -> 1,20,00,000
--   Gayathri (CMRGA)     1,25,00,000 ->   42,02,123
--   Dharshan (RRG)         75,00,000  unchanged
--   Vasudharini (ECM)      50,00,000 ->   62,00,000
--   Ekta (GADD)             50,00,000 ->   63,00,000
--   Common                  25,00,000  unchanged
--   Raja (AIF)               25,00,000  unchanged
--   Jayanth IPO (JIPO)        25,00,000  unchanged
--   HRCM                    24,00,000 -> no revenue target (its own revenue
--                                        already plays no part in the vertical
--                                        cost apportionment card either)
--   Meenakshi (ACC)          50,00,000 -> no revenue target, same reason
--   Akshayam (GIFT)        1,25,00,000 -> 1,55,00,000
--
-- Collection targets are untouched - only revenue was revised. Idempotent:
-- the updates set a fixed figure and the deletes are a no-op once applied.
-- ============================================================

update budgets b
   set annual_amount = v2.amount
  from entities e
  join verticals v on v.entity_id = e.id
  join (values
    ('DLR',    20000000),
    ('CFC',    12000000),
    ('CMRGA',   4202123),
    ('RRG',     7500000),
    ('ECM',     6200000),
    ('GADD',    6300000),
    ('COMMON',  2500000),
    ('AIF',     2500000),
    ('JIPO',    2500000)
  ) as v2(code, amount) on v2.code = v.code
 where e.slug = 'rbjv'
   and b.entity_id = e.id and b.vertical_id = v.id
   and b.fy_start_year = 2026 and b.measure = 'revenue';

update budgets b
   set annual_amount = 15500000
  from entities e
  join verticals v on v.entity_id = e.id and v.code = 'GIFT'
 where e.slug = 'akshayam'
   and b.entity_id = e.id and b.vertical_id = v.id
   and b.fy_start_year = 2026 and b.measure = 'revenue';

delete from budgets b
  using entities e, verticals v
 where e.slug = 'rbjv'
   and b.entity_id = e.id and b.vertical_id = v.id and v.code in ('HRCM', 'ACC')
   and b.fy_start_year = 2026 and b.measure = 'revenue';

-- ============================================================
-- FY 2026-27 collection budget, kept at the firm's own standing rule:
-- collection runs 8% above revenue (recovery of tax withheld, and billed
-- value expected to convert within the year - see 010_budgets.sql). The
-- revenue revision in 066 broke that ratio for every vertical it touched;
-- this restores it, derived from whatever each vertical's revenue row
-- currently says rather than a second set of hardcoded figures, so the two
-- can never drift out of the stated ratio again by a copy-paste slip.
--
-- HRCM and ACC lost their revenue target in 066 (their own revenue plays no
-- part in the vertical cost apportionment either); 108% of no target is no
-- target, so their collection rows are dropped the same way.
-- ============================================================

update budgets c
   set annual_amount = round(r.annual_amount * 1.08, 2)
  from budgets r
 where c.measure = 'collection' and r.measure = 'revenue'
   and c.entity_id = r.entity_id
   and c.vertical_id is not distinct from r.vertical_id
   and c.fy_start_year = 2026 and r.fy_start_year = 2026;

delete from budgets b
  using entities e, verticals v
 where e.slug = 'rbjv'
   and b.entity_id = e.id and b.vertical_id = v.id and v.code in ('HRCM', 'ACC')
   and b.fy_start_year = 2026 and b.measure = 'collection';

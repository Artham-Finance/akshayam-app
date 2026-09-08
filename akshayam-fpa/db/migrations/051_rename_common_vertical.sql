-- ============================================================
-- Rename the Common vertical.
--
-- "Common (also partners contribution) incl other services" was the label
-- carried since 029 merged Partner Contribution in and again since 049 split
-- "other services" out to the DSC and support vertical. With that split done
-- the "incl other services" half is stale, so the partners have shortened it
-- to "Common incl partners contribution".
--
-- Two stores hold the display string: the vertical itself, and the budget
-- rows, whose display_name shadows the vertical name in buildBudgetVsActual
-- (see budget.ts). Both are updated so every tab reads the new label.
-- RBJV only - Common (vertical_id 10) exists for RBJV alone.
-- ============================================================

update verticals
   set name = 'Common incl partners contribution'
 where entity_id = 1 and id = 10;

update budgets
   set display_name = 'Common incl partners contribution'
 where entity_id = 1 and vertical_id = 10
   and display_name = 'Common (also partners contribution) incl other services';

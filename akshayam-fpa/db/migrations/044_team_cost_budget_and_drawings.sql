-- ============================================================
-- Two corrections and one simplification.
--
-- 1. Team-cost budget is now hard-coded in the app (src/lib/reports/
--    team-cost.ts), straight from the firm's "team cost - budget" workbook -
--    one annual figure per vertical x role, not editable. The table 043 added
--    to key it in is therefore dropped; the entered actuals stay.
--
-- 2. Partners' drawings on the RBJV budgeted P&L were carried at 5,00,000 a
--    month (60,00,000 a year). The agreed figure is 7,00,000 a month -
--    84,00,000 for the year.
-- ============================================================

drop table if exists team_cost_budget;

update budget_pnl
   set amount = 700000
 where group_code = 'partner_drawings'
   and entity_id = (select id from entities where slug = 'rbjv');

-- ============================================================
-- Team-cost actuals now come straight from the general ledger.
--
-- Every direct_cost GL entry carries a vertical tag, so the actual side of the
-- Team cost card is read from gl_entries by vertical and account - the same
-- source and sign convention as the P&L - and mapped to the card's roles:
--
--   Professional Fees          -> Team lead
--   Consultancy Charges        -> External consultant
--   Performance Incentive      -> VPP
--   Salaries and Employee Wages -> Employee
--   (Trainee has no ledger account; its actual stays nil)
--
-- The hand-entered actuals table is therefore dropped - nothing keys into it
-- any more. The budget stays hard-coded in src/lib/reports/team-cost.ts.
-- ============================================================

drop table if exists team_cost_actual;

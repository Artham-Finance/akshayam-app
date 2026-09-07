-- ============================================================
-- The team-cost budget workbook carries five role rows, not three:
-- team lead, external consultant, VPP, employee, trainee. Widen the
-- check constraint on the entered actuals to match.
-- ============================================================

alter table team_cost_actual drop constraint team_cost_actual_role_check;

alter table team_cost_actual
  add constraint team_cost_actual_role_check
  check (role in ('team_lead', 'external_consultant', 'vpp', 'employee', 'trainee'));

-- ============================================================
-- Akshayam's "Other expenses" breakdown.
--
-- The Akshayam planning sheet states its overheads as one allocation of common
-- cost and carries no line-by-line schedule, so unlike RBJV it seeded no
-- expense_budget_lines and the Budget-vs-Actual "Other expenses" card showed
-- only Misc and the reimbursement pair.
--
-- The agreed split of the 16,25,254 budgeted (budget_pnl 'overheads' for
-- Akshayam, FY 2026-27):
--
--   Accounting support             2,40,000
--   Other Expenses (Travel)        3,00,000
--   Allocable expenses from RBJV  10,85,254   (the common cost RBJV charges on)
--   -----------------------------------------
--                                 16,25,254
--
-- Same shape as RBJV's lines - twelve monthly rows each, head = label so they
-- render flat - so buildExpenseDetail needs no change: it reads these, appends
-- Misc (Others) for anything unbudgeted, and pulls Reimbursement expenses and
-- income straight from the ledger, exactly as it does for RBJV.
--
-- Note: a re-upload of the Akshayam budget workbook clears entity 2's
-- expense_budget_lines and the sheet re-seeds none, so this migration would
-- need re-applying after one.
-- ============================================================

insert into expense_budget_lines
  (entity_id, fy_start_year, head, label, month, amount, sort_order)
select 2, 2026, v.head, v.label,
       (date '2026-04-01' + (n || ' months')::interval)::date as month,
       case when n = 11
            then v.annual - (v.annual / 12) * 11        -- last month carries the rounding
            else v.annual / 12
       end as amount,
       v.sort_order
  from (values
    ('Accounting support',           'Accounting support',            240000, 10),
    ('Other Expenses (Travel)',      'Other Expenses (Travel)',       300000, 20),
    ('Allocable expenses from RBJV', 'Allocable expenses from RBJV', 1085254, 30)
  ) as v(head, label, annual, sort_order),
  generate_series(0, 11) as n
on conflict (entity_id, fy_start_year, head, label, month) do nothing;

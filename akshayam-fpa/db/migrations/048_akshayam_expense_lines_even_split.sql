-- ============================================================
-- 047 split Akshayam's three "Other expenses" budget lines into twelve months
-- with integer division and the rounding dumped in March. That left the card's
-- budget total a few rupees short of budget_pnl's 'overheads', which carries
-- 1,35,437.86 a month exactly.
--
-- Re-do it as an even numeric twelfth (annual / 12, two decimals), the same way
-- budget_pnl holds it, so the "Other expenses" card ties to the statement line
-- above it to the rupee.
-- ============================================================

delete from expense_budget_lines where entity_id = 2 and fy_start_year = 2026;

insert into expense_budget_lines
  (entity_id, fy_start_year, head, label, month, amount, sort_order)
select 2, 2026, v.head, v.label,
       (date '2026-04-01' + (n || ' months')::interval)::date as month,
       round(v.annual::numeric / 12, 2) as amount,
       v.sort_order
  from (values
    ('Accounting support',           'Accounting support',            240000, 10),
    ('Other Expenses (Travel)',      'Other Expenses (Travel)',       300000, 20),
    ('Allocable expenses from RBJV', 'Allocable expenses from RBJV', 1085254, 30)
  ) as v(head, label, annual, sort_order),
  generate_series(0, 11) as n;

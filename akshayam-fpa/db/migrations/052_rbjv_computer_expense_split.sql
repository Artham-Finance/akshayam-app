-- ============================================================
-- Budget vs Actual: split RBJV's "Computer & Software" into two groups.
--
-- The RBJV planning sheet carries technology spend as one promoted head,
-- "Computer & Software" (FY 2026-27 budget 8,59,351 = 8,09,351 of computer and
-- software plus 50,000 of domain renewal, folded in by the parser). The
-- partners now read it as two groups with a line-by-line schedule behind each:
--
--   Computer - subscription        6,05,351   (incl. the 50,000 domain renewal,
--                                               which falls in April)
--   Computer maintenance charges     2,54,000
--   --------------------------------------------
--                                  8,59,351   unchanged - Other expenses still
--                                             ties to budget_pnl 'overheads'
--
-- Same shape as the other multi-line heads (Staff Welfare, Other Expenses):
-- one monthly row per vendor line, head <> label so each renders indented
-- under a head separator. buildExpenseDetail needs no change.
--
-- Professional Development / DSC Expenses / MCA Expenses are renumbered to sit
-- after the two computer groups, where the single head used to be.
--
-- Note: a re-upload of the RBJV budget workbook clears entity 1's
-- expense_budget_lines and the sheet re-seeds one flat "Computer & Software"
-- head, so this migration needs re-applying after one.
-- ============================================================

delete from expense_budget_lines
 where entity_id = 1 and fy_start_year = 2026 and head = 'Computer & Software';

insert into expense_budget_lines (entity_id, fy_start_year, head, label, month, amount, sort_order)
values
  -- Computer - subscription
  (1, 2026, 'Computer - subscription', 'ZOHO',                  '2026-09-01',  57600, 301),
  (1, 2026, 'Computer - subscription', 'ZOHO',                  '2026-11-01',   6584, 301),
  (1, 2026, 'Computer - subscription', 'ZOHO',                  '2027-01-01',  57600, 301),
  (1, 2026, 'Computer - subscription', 'ZOHO',                  '2027-03-01',  60945, 301),
  (1, 2026, 'Computer - subscription', 'Comply relax',          '2026-07-01',  88500, 302),
  (1, 2026, 'Computer - subscription', 'Jamko',                 '2026-08-01',  40617, 303),
  (1, 2026, 'Computer - subscription', 'Manupatra',             '2026-10-01',  23305, 304),
  (1, 2026, 'Computer - subscription', 'Google workspace',      '2026-04-01', 113200, 305),
  (1, 2026, 'Computer - subscription', 'Anti virus',            '2026-04-01',  40000, 306),
  (1, 2026, 'Computer - subscription', 'Chat gpt subscription', '2026-04-01',  15000, 307),
  (1, 2026, 'Computer - subscription', 'Fire wall',             '2026-04-01',  52000, 308),
  (1, 2026, 'Computer - subscription', 'Domain Renewal',        '2026-04-01',  50000, 309),
  -- Computer maintenance charges (one-offs; "IT guy" seeded below)
  (1, 2026, 'Computer maintenance charges', 'Techno - website revamp', '2026-04-01', 15000, 311),
  (1, 2026, 'Computer maintenance charges', 'Fee for logo in screens', '2026-04-01', 19000, 312),
  (1, 2026, 'Computer maintenance charges', 'Lenovo idea pad',         '2026-04-01', 40000, 313);

-- IT guy: 15,000 every month of the year.
insert into expense_budget_lines (entity_id, fy_start_year, head, label, month, amount, sort_order)
select 1, 2026, 'Computer maintenance charges', 'IT guy',
       (date '2026-04-01' + (n || ' months')::interval)::date, 15000, 310
  from generate_series(0, 11) as n;

-- Slot the other promoted heads after the two computer groups.
update expense_budget_lines set sort_order = 320
 where entity_id = 1 and fy_start_year = 2026 and head = 'Professional Development';
update expense_budget_lines set sort_order = 321
 where entity_id = 1 and fy_start_year = 2026 and head = 'DSC Expenses';
update expense_budget_lines set sort_order = 322
 where entity_id = 1 and fy_start_year = 2026 and head = 'MCA Expenses';

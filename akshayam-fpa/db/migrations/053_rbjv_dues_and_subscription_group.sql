-- ============================================================
-- Budget vs Actual (RBJV): a "Dues and subscription" group, plus a catch-all
-- under each computer group.
--
-- Builds on 052. Two moves in the data:
--
--   * "Chat gpt subscription" leaves Computer - subscription for a new
--     "Dues and subscription" head.
--   * The "Dues & Subscriptions" line under Other Expenses (FY 2026-27 budget
--     32,050 - 17,300 in April, 14,750 in November) is renamed "ICSI
--     membership" and moved to the same new head. All of the dues budget sits
--     on that line; IBBI membership and the group's "Other" carry none.
--
-- The unbudgeted lines - "Others (not budgeted)" under each computer group, and
-- "IBBI membership" / "Other" under the dues group - carry no budget and are
-- added by buildExpenseDetail (the same way "Misc (Others)" is), so they
-- survive a budget re-upload.
--
-- Head totals only move between heads, so Other expenses still ties to
-- budget_pnl 'overheads':
--   Computer - subscription   6,05,351 -> 5,90,351   (- chat gpt 15,000)
--   Dues and subscription            0 ->   47,050   (+ chat gpt + ICSI)
--   Other Expenses            5,43,050 -> 5,11,000   (- dues & subs 32,050)
--
-- Note: a re-upload of the RBJV budget workbook rebuilds the sheet's rows and
-- would need this (and 052) re-applying.
-- ============================================================

update expense_budget_lines
   set head = 'Dues and subscription', sort_order = 314
 where entity_id = 1 and fy_start_year = 2026
   and head = 'Computer - subscription' and label = 'Chat gpt subscription';

update expense_budget_lines
   set head = 'Dues and subscription', label = 'ICSI membership', sort_order = 315
 where entity_id = 1 and fy_start_year = 2026
   and head = 'Other Expenses' and label = 'Dues & Subscriptions';

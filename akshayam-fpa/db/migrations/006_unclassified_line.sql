-- ============================================================
-- A home for balances nobody has classified yet.
--
-- Six RBJV accounts carry opening balances but no reporting line - a partner
-- current account, an investment, a couple of statutory items. Dropping them
-- from the balance sheet left it Rs 85,691 out and gave no clue where the
-- money was; the statement said only that something was missing.
--
-- They now appear on their own line, under their own names, inside the totals.
-- The balance sheet ties, the reader can see exactly what has not been placed,
-- and the account-mapping screen still asks for a decision. Showing an awkward
-- balance where it actually sits beats hiding it behind a warning.
-- ============================================================

insert into report_groups
  (entity_id, statement, code, name, sort_order, is_subtotal, subtotal_of, sign)
select id, 'bs', 'unclassified', 'Unclassified', 155, false, null, -1
  from entities;

update report_groups
   set subtotal_of = array['equity','reserves','borrowings','payables','other_liab','unclassified']
 where statement = 'bs' and code = 'total_eq_liab';

-- ============================================================
-- Intercompany movements on the consolidated cash flow.
--
-- Eliminating intercompany *balances* is right for the balance sheet. Doing
-- the same to their *movements* breaks the cash flow, because the cash those
-- movements went with is still there: the group's own statement came out Rs 505
-- adrift, being an Akshayam customer invoice posted to the RBJV intercompany
-- account that RBJV never recorded.
--
-- Money genuinely moving between the two companies nets to nothing and
-- disappears from this line on its own. What is left is the amount the two
-- ledgers disagree by - the same difference the balance sheet carries, seen as
-- a flow. It gets its own line rather than being buried in working capital.
-- ============================================================

insert into report_groups
  (entity_id, statement, code, name, sort_order, is_subtotal, subtotal_of, sign)
select id, 'cf', 'cf_interco', 'Intercompany, Not Eliminated', 104, false, null, 1
  from entities;

update report_groups
   set subtotal_of = array['cfo','cfi','cff','cf_interco','cf_unclassified']
 where statement = 'cf' and code = 'net_change';

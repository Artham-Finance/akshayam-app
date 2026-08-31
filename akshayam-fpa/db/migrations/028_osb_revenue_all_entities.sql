-- ============================================================
-- OSB Revenue, for every entity - not only RBJV.
--
-- 026_osb_revenue.sql gave RBJV its own "OSB Revenue" account and
-- report_groups line, since that is the entity the outside-books invoices
-- were raised against. But accounts and report_groups are held per entity
-- (loadGroups reads entity.id, not entity.memberIds), and Group, RAJA and
-- each single-vertical slice entity all keep their own copies of both
-- tables - so none of them had a place for an OSB row to land.
--
-- The effect was not a missing line label: assemble() drops a FlatRow whose
-- group_code names no known group for that entity, so the Group P&L
-- silently excluded OSB revenue from Gross Profit, EBITDA, EBIT, PBT and PAT
-- - not just from the revenue line - while flagging the same rupees as
-- "activity missing from this statement". This gives every entity the same
-- account and report_groups row RBJV already has, and folds it into Gross
-- Profit the same way, so an OSB invoice reaches every statement it can
-- legitimately appear on rather than only the one company it was raised in.
-- ============================================================

insert into accounts (entity_id, name, zoho_type, statement, group_code, sort_order, is_mapped)
select e.id, 'OSB Revenue', 'Income', 'pnl', 'osb_revenue', 15, true
  from entities e
 where not exists (select 1 from accounts a where a.entity_id = e.id and a.name = 'OSB Revenue');

insert into report_groups (entity_id, statement, code, name, sort_order, is_subtotal, sign)
select e.id, 'pnl', 'osb_revenue', 'OSB Revenue', 15, false, 1
  from entities e
 where not exists (
   select 1 from report_groups rg where rg.entity_id = e.id and rg.statement = 'pnl' and rg.code = 'osb_revenue');

update report_groups
   set subtotal_of = array_append(subtotal_of, 'osb_revenue')
 where statement = 'pnl' and code = 'gross_profit'
   and not ('osb_revenue' = any(subtotal_of));

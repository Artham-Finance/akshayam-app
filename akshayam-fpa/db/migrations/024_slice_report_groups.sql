-- ============================================================
-- The statement structure 022's six slice companies were missing.
--
-- P&L, Balance Sheet and Cash Flow each load their line structure by the
-- *viewing* entity's own id (loadGroups(entity.id, ...) in statements.ts) -
-- RAJA has always carried its own copy of RBJV's report_groups for exactly
-- this reason, one row for one row, statement for statement. 022 copied the
-- other half of what makes a slice work - entities and entity_members - and
-- missed this half, so a CMRGA login saw every rupee of its own ledger
-- activity reported as unmapped: not because any account lacked a reporting
-- line, but because the entity asking the question had no lines to place
-- anything under at all.
--
-- budget_pnl and expense_entries are deliberately left alone. RAJA has no
-- rows in either - a slice's budget and its pooled-expense detail are
-- prepared by hand against a real company, not manufactured for a company
-- that exists only to narrow a view - so those sections stay empty on the
-- six new companies exactly as they already do on RAJA, which is the
-- existing, working behaviour rather than a second gap.
-- ============================================================

insert into report_groups
  (entity_id, statement, code, name, parent_code, sort_order, is_subtotal, subtotal_of, sign)
select e.id, rg.statement, rg.code, rg.name, rg.parent_code, rg.sort_order, rg.is_subtotal,
       rg.subtotal_of, rg.sign
  from entities e
  join entities rbjv on rbjv.slug = 'rbjv'
  join report_groups rg on rg.entity_id = rbjv.id
 where e.slug in ('cmrga', 'cfc', 'dlr', 'rrg', 'ecm', 'gadd')
   and not exists (
         select 1 from report_groups x
          where x.entity_id = e.id and x.statement = rg.statement and x.code = rg.code);

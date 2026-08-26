-- ============================================================
-- Cash flow, indirect method.
--
-- The statement is built entirely from cf_category, and it ties by
-- construction rather than by a plug. Every journal balances, so across a
-- period the movements on all accounts sum to zero:
--
--   m(cash) + m(everything else) = 0     where m(a) = debit - credit
--
-- so the increase in cash equals minus the movement on every other account.
-- Each cash-flow line is therefore just -m(a) for the accounts in its bucket,
-- and the buckets partition the chart of accounts. Nothing can go missing: an
-- account nobody has categorised lands on its own "Unclassified" line, exactly
-- as an unclassified balance does on the balance sheet.
--
-- Three corrections to existing categories, all of which change where real
-- money appears:
--
--   finance costs      were "financing", which would have lifted interest out
--                      of profit before tax and left the statement's opening
--                      line disagreeing with the P&L
--   income tax         had no category of its own, so the tax line could never
--                      be anything but empty
--   accumulated depn   was "investing", which nets the depreciation charge off
--                      against asset purchases instead of adding it back
-- ============================================================

insert into report_groups
  (entity_id, statement, code, name, sort_order, is_subtotal, subtotal_of, sign)
select id, 'cf', 'cf_unclassified', 'Unclassified Movements', 105, false, null, 1
  from entities;

update report_groups
   set subtotal_of = array['cfo','cfi','cff','cf_unclassified']
 where statement = 'cf' and code = 'net_change';

-- ---------- category corrections ----------

update accounts set cf_category = 'pnl'
 where statement = 'pnl' and group_code = 'finance_cost' and cf_category is distinct from 'pnl';

update accounts set cf_category = 'tax'
 where statement = 'pnl' and group_code = 'tax';

-- Income tax carried on the balance sheet: advance tax paid, provisions for
-- tax, deferred tax. Deliberately NOT TDS or GST control accounts - those are
-- settled with customers and the revenue authority as part of ordinary trade,
-- and belong in working capital where the client already reads them.
update accounts set cf_category = 'tax'
 where statement = 'bs'
   and name ~* '\y(advance tax|income tax|provision for tax|tax provision|deferred tax|self assessment tax)\y';

update accounts set cf_category = 'non_cash_addback'
 where statement = 'bs' and name ~* '\yaccumulated\s+(depreciation|amortisation|amortization)\y';

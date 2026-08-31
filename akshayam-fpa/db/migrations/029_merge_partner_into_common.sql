-- ============================================================
-- Merge Jayanth's Partner Contribution vertical into Common.
--
-- Common's ledger tag and its invoice-register tag were already known to
-- diverge (the ledger reads 11.8L against the register's 3.2L - see the
-- comment on actualsByVertical in budget.ts) and accepted as the ledger's
-- own posted classification winning over the invoice's salesperson-parsed
-- one. Sitting the numbers for every vertical side by side surfaced the same
-- divergence at Partner Contribution, and larger: the ledger read 6.4L
-- against the register's 13.94L, a 7.54L gap - more than double either way,
-- and the single biggest source of "Revenue tab" and "P&L" disagreeing.
--
-- Both verticals are the same kind of catch-all - work that is not any one
-- partner's client, or common-cost recovery - so where a given rupee lands
-- between them was always a soft call for whoever tagged it, on either side.
-- Combining them turns two soft, disagreeing splits into one number both
-- sources land close to. RBJV only: Partner Contribution (vertical_id 9)
-- exists for RBJV alone.
-- ============================================================

-- Every table that carries the vertical tag: point Partner's rows at Common.
update gl_entries         set vertical_id = 10 where entity_id = 1 and vertical_id = 9;
update invoice_lines      set vertical_id = 10 where entity_id = 1 and vertical_id = 9;
update ar_open_items      set vertical_id = 10 where entity_id = 1 and vertical_id = 9;
update payments           set vertical_id = 10 where entity_id = 1 and vertical_id = 9;
update credit_notes       set vertical_id = 10 where entity_id = 1 and vertical_id = 9;
update payment_allocations set vertical_id = 10 where entity_id = 1 and vertical_id = 9;

-- Salesperson-text variants that used to resolve to Partner Contribution now
-- resolve straight to Common on the next upload, rather than recreating the
-- vertical this migration is removing.
update vertical_aliases set vertical_id = 10 where entity_id = 1 and vertical_id = 9;

-- The two budgets (revenue and collection) add together rather than being
-- picked one over the other - the merged vertical's target is the sum of
-- what both halves were separately budgeted for.
update budgets b
   set annual_amount = b.annual_amount + p.annual_amount,
       display_name = 'Common (also partners contribution) incl other services'
  from budgets p
 where b.entity_id = 1 and b.vertical_id = 10
   and p.entity_id = 1 and p.vertical_id = 9
   and p.measure = b.measure and p.fy_start_year = b.fy_start_year;

delete from budgets where entity_id = 1 and vertical_id = 9;

update verticals
   set name = 'Common (also partners contribution) incl other services'
 where entity_id = 1 and id = 10;

delete from verticals where entity_id = 1 and id = 9;

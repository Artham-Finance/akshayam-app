-- ============================================================
-- Akshayam's "MCA Expenses" account was mapped direct_cost, unlike RBJV's own
-- equivalent ("MCA expenses to be absorbed"), which is overheads - a
-- statutory filing fee is not a team cost. Left as direct_cost, every posting
-- on it fell into Team Cost's "External consultant" row (the catch-all for
-- any direct_cost account that names no role of its own), inflating that row
-- with something that was never a consultant's fee.
-- ============================================================

update accounts
   set group_code = 'overheads'
 where entity_id = (select id from entities where slug = 'akshayam')
   and name = 'MCA Expenses'
   and statement = 'pnl';

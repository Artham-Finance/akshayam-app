-- ============================================================
-- Cash flow reclassification, confirmed by the partners, across every entity:
--
--   * The mutual-fund holdings - Invesco, Mirae, Nippon, Canara Robeco,
--     Aditya Birla - are investments. Their movement is an investing activity,
--     not a working-capital change.
--   * Credit-card accounts are payables settled within the operating cycle.
--     Their movement is a working-capital change, not a financing activity.
--
-- Only cf_category (the cash-flow bucket) is touched; the balance-sheet
-- grouping is left as it is. TDS-prefixed accounts named after a fund are
-- recoverable tax, not a holding, and are explicitly excluded.
-- ============================================================

update accounts
   set cf_category = 'investing'
 where statement = 'bs'
   and cf_category is distinct from 'investing'
   and name not ilike 'TDS%'
   and (
        name ilike 'Invesco%'
     or name ilike 'Mirae%'
     or name ilike 'Nippon%'
     or name ilike 'Canara Robec%'
     or name ilike 'Aditya Birla%'
   );

update accounts
   set cf_category = 'wc_operating'
 where statement = 'bs'
   and cf_category is distinct from 'wc_operating'
   and name ilike 'Credit Card%';

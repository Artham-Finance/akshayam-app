-- ============================================================
-- The order the budget lists its verticals in.
--
-- Sorting by size instead put the largest first, which reads fine and matches
-- nothing: the partners know their budget by its running order and read down
-- it looking for their own line. A report that reorders the schedule it is
-- reporting against makes the reader hunt.
--
-- Taken from the annual budget sheet, with Raja's GIFT book last exactly as it
-- sits there - below the RBJV total, being the other company.
-- ============================================================

alter table budgets add column sort_order int not null default 999;

update budgets b
   set sort_order = o.rank
  from (values
    ('rbjv',     'DLR',     10),
    ('rbjv',     'CFC',     20),
    ('rbjv',     'CMRGA',   30),
    ('rbjv',     'RRG',     40),
    ('rbjv',     'ECM',     50),
    ('rbjv',     'HRCM',    60),
    ('rbjv',     'ACC',     70),
    ('rbjv',     'GADD',    80),
    ('rbjv',     'COMMON',  90),
    ('rbjv',     'AIF',    100),
    ('rbjv',     'PARTNER',110),
    ('akshayam', 'GIFT',   120)
  ) as o(slug, code, rank)
  join verticals v on v.code = o.code
  join entities e on e.id = v.entity_id and e.slug = o.slug
 where b.vertical_id = v.id;

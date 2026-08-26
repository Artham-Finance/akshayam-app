-- ============================================================
-- Head count by vertical, FY 2026-27, from the budget's own
-- "COMMON COST APPORTIONMENT STATEMENT".
--
-- Two of the nine budget verticals are one book split across two companies:
-- V10 "Gift & Regulatory" is Raja's, and its five people sit in Akshayam. The
-- heads go where the payroll is, so RBJV's AIF vertical carries none - the
-- apportionment then charges Akshayam for the team that does the work.
-- ============================================================

insert into vertical_headcount (vertical_id, fy_start_year, heads)
select v.id, 2026, h.heads
  from verticals v
  join entities e on e.id = v.entity_id
  join (values
    ('rbjv',     'ECM',   3),
    ('rbjv',     'GADD',  4),
    ('rbjv',     'CMRGA', 3),
    ('rbjv',     'DLR',   4),
    ('rbjv',     'RRG',   4),
    ('rbjv',     'CFC',   5),
    ('rbjv',     'ACC',   6),
    ('rbjv',     'HRCM',  2),
    ('rbjv',     'AIF',   0),
    ('akshayam', 'GIFT',  5)
  ) as h(slug, code, heads) on h.slug = e.slug and h.code = v.code
on conflict (vertical_id, fy_start_year) do update set heads = excluded.heads;

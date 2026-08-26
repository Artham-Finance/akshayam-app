-- ============================================================
-- Annual budgets by vertical, for revenue and for collections.
--
-- Two measures, because the firm budgets them separately: the collection
-- budget runs about 8% above the revenue budget, which is the recovery of tax
-- withheld and billed value expected to convert within the year.
--
-- Held against the canonical vertical rather than the partner's name, so a
-- partner changing seats does not silently move a budget. The names the client
-- uses are recorded alongside, because the report has to read the way they
-- already read it.
-- ============================================================

create table budgets (
  id            serial primary key,
  entity_id     int  not null references entities(id) on delete cascade,
  vertical_id   int  references verticals(id) on delete cascade,
  fy_start_year int  not null,
  -- 'revenue' is invoiced fee value; 'collection' is cash received
  measure       text not null check (measure in ('revenue', 'collection')),
  annual_amount numeric(18,2) not null default 0,
  /** the client's own label, e.g. "Vijay - Disputes, Litigation & Resolution" */
  display_name  text,
  unique (entity_id, vertical_id, fy_start_year, measure)
);

create index budgets_lookup_idx on budgets (entity_id, fy_start_year, measure);

-- ---------- RBJV, FY 2026-27 ----------

insert into budgets (entity_id, vertical_id, fy_start_year, measure, annual_amount, display_name)
select e.id, v.id, 2026, m.measure,
       case m.measure when 'collection' then b.collection else b.revenue end,
       b.display_name
  from entities e
  join verticals v on v.entity_id = e.id
  join (values
    ('DLR',     21600000, 20000000, 'Vijay - Disputes, Litigation & Resolution'),
    ('CFC',     11880000, 11000000, 'Rekha - Corporate Formation & Secretarial Compliances'),
    ('CMRGA',   13500000, 12500000, 'Gayathri - Capital Markets Readiness & Governance Assurance'),
    ('RRG',      8100000,  7500000, 'Dharshan - Remedial, Regulatory & Secretarial Compliances'),
    ('ECM',      5400000,  5000000, 'Vasudharini - Enterprise Compliance Management'),
    ('HRCM',     2592000,  2400000, 'Mahalakshmi.R - HR Compliance Management'),
    ('ACC',      5400000,  5000000, 'Meenakshi - ACC'),
    ('GADD',     5400000,  5000000, 'Ekta - Governance Assurance & Due Diligence'),
    ('COMMON',   2700000,  2500000, 'Common incl. Other Services (Vaithy)'),
    ('AIF',      2700000,  2500000, 'Raja - AIF and Support'),
    ('PARTNER',  2700000,  2500000, 'Jayanth - Partner Contribution / IPO')
  ) as b(code, collection, revenue, display_name) on b.code = v.code
 cross join (values ('revenue'), ('collection')) as m(measure)
 where e.slug = 'rbjv';

-- ---------- Akshayam, FY 2026-27 ----------
-- One vertical, so one line: GIFT and Support.

insert into budgets (entity_id, vertical_id, fy_start_year, measure, annual_amount, display_name)
select e.id, v.id, 2026, m.measure,
       case m.measure when 'collection' then 13500000 else 12500000 end,
       'Raja - GIFT and Support'
  from entities e
  join verticals v on v.entity_id = e.id and v.code = 'GIFT'
 cross join (values ('revenue'), ('collection')) as m(measure)
 where e.slug = 'akshayam';

-- ============================================================
-- The rest of RBJV's verticals, on the same recipe as 022 - a slice per
-- vertical, so it can be granted like any other company.
--
-- 022 deliberately stopped at six: "every other RBJV vertical - ACC, HR
-- Compliance Management, Partner's Contribution, Common, Unallocated - has
-- nobody named to it in the roster this seeds against." That was true for a
-- team-lead grant. It stops being true the moment someone needs to see every
-- vertical at once rather than the whole company - the founder's own use,
-- not a team lead's - and the entity picker is the only place that reads
-- "one vertical" today; there is no other way to hand that out.
--
-- AIF gets its own RBJV-only slice alongside RAJA's combined one: RAJA is
-- AIF (RBJV) plus GIFT (Akshayam) together, which is a different thing from
-- RBJV's own AIF vertical on its own.
--
-- Unallocated is left out on purpose - it is where activity with no vertical
-- tag lands, not a vertical anyone runs, and a slice of it would be a
-- company with nothing to report as its own business.
-- ============================================================

insert into entities (slug, name, currency, fy_start_month, consolidates)
select v.slug, v.name, 'INR', 4, false
  from (values
    ('aif',    'AIF and Support'),
    ('acc',    'Akshayam Capability Center'),
    ('hrcm',   'HR Compliance Management'),
    ('dsc',    'DSC and support'),
    ('common', 'Common incl partners contribution'),
    ('jipo',   'Jayanth IPO')
  ) as v(slug, name)
 where not exists (select 1 from entities e where e.slug = v.slug);

insert into entity_members (entity_id, member_entity_id, vertical_id)
select e.id, rbjv.id, ver.id
  from entities e
  join (values
    ('aif',    'AIF'),
    ('acc',    'ACC'),
    ('hrcm',   'HRCM'),
    ('dsc',    'DSC'),
    ('common', 'COMMON'),
    ('jipo',   'JIPO')
  ) as m(slug, code) on m.slug = e.slug
  join entities rbjv on rbjv.slug = 'rbjv'
  join verticals ver on ver.entity_id = rbjv.id and ver.code = m.code
 where not exists (
         select 1 from entity_members x
          where x.entity_id = e.id
            and x.member_entity_id = rbjv.id
            and x.vertical_id = ver.id);

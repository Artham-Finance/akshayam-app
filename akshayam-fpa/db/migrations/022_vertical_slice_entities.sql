-- ============================================================
-- Six more single-vertical companies, on the recipe RAJA already proved.
--
-- A slice is an entity whose entity_members row names one company and one
-- vertical - every report already knows how to scope to that, since RAJA
-- (GIFT + AIF) has been reading that way since 012_entity_members. What is
-- new here is not the mechanism, only using it for one vertical instead of
-- two, per person rather than per partner-led combination.
--
-- The reason to reach for it: access control (020_auth) only ever grants a
-- whole company - there is no "this vertical of RBJV" grant to hand someone.
-- A slice turns a vertical into a company of its own, so the ordinary grant
-- mechanism can hand out exactly that and nothing either side of it. A viewer
-- holding only the CMRGA slice cannot switch to "All verticals" and see the
-- rest of RBJV, because RBJV is not among the companies they were ever
-- granted - the boundary is in the query, not in a picker they could set
-- back.
--
-- Deliberately six, not eleven: every other RBJV vertical - ACC, HR
-- Compliance Management, Partner's Contribution, Common, Unallocated - has
-- nobody named to it in the roster this seeds against, and stays exactly
-- where it is, visible only to whoever already holds the whole of RBJV.
-- Slicing a vertical nobody was granted would only be a company with no one
-- in it.
-- ============================================================

insert into entities (slug, name, currency, fy_start_month, consolidates)
select v.slug, v.name, 'INR', 4, false
  from (values
    ('cmrga', 'Capital Markets Readiness & Governance Assurance'),
    ('cfc',   'Corporate Formation & Secretarial Compliances'),
    ('dlr',   'Disputes, Litigation & Resolution'),
    ('rrg',   'Remedial, Regulatory & Secretarial Compliances'),
    ('ecm',   'Enterprise Compliance Management'),
    ('gadd',  'Governance Assurance & Due Diligence')
  ) as v(slug, name)
 where not exists (select 1 from entities e where e.slug = v.slug);

insert into entity_members (entity_id, member_entity_id, vertical_id)
select e.id, rbjv.id, ver.id
  from entities e
  join (values
    ('cmrga', 'CMRGA'),
    ('cfc',   'CFC'),
    ('dlr',   'DLR'),
    ('rrg',   'RRG'),
    ('ecm',   'ECM'),
    ('gadd',  'GADD')
  ) as m(slug, code) on m.slug = e.slug
  join entities rbjv on rbjv.slug = 'rbjv'
  join verticals ver on ver.entity_id = rbjv.id and ver.code = m.code
 where not exists (
         select 1 from entity_members x
          where x.entity_id = e.id
            and x.member_entity_id = rbjv.id
            and x.vertical_id = ver.id);

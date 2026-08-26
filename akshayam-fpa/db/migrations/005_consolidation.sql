-- ============================================================
-- Consolidation across the group.
--
-- The group is modelled as an entity like any other, with the two trading
-- companies pointing at it as their parent. Everything downstream then works
-- on a *set* of entity ids rather than one: a company reports on itself, the
-- group reports on its members. No page has to know which case it is in, and a
-- third company would need no code at all.
--
-- The group holds no ledger of its own - nothing may be uploaded against it -
-- but it does own a copy of the statement layout, because report_groups is
-- keyed by entity and the consolidated statements are assembled from it.
--
-- Intercompany balances are the one thing a consolidation must do that an
-- addition cannot. RBJV carries "Inter Company - Akshayam" and Akshayam
-- carries "Inter concern - RBJV"; left alone they would inflate both the asset
-- and liability side of the group balance sheet with money the group owes
-- itself. They are flagged here and removed in the statement builder, which
-- also surfaces whatever the two sides disagree by rather than hiding it.
-- ============================================================

alter table entities add column parent_id int references entities(id) on delete set null;
create index entities_parent_idx on entities (parent_id);

-- Zoho's own name for the company, which is what appears on its exports.
update entities
   set name = 'Akshayam Corporate Advisors Private Limited'
 where slug = 'akshayam';

insert into entities (slug, name, currency, fy_start_month)
values ('group', 'Group (consolidated)', 'INR', 4);

update entities
   set parent_id = (select id from entities where slug = 'group')
 where slug in ('rbjv', 'akshayam');

-- The group's statement layout mirrors the companies' - a consolidated P&L
-- that read differently from the ones it consolidates would be unusable.
insert into report_groups
  (entity_id, statement, code, name, parent_code, sort_order, is_subtotal, subtotal_of, sign)
select g.id, r.statement, r.code, r.name, r.parent_code, r.sort_order,
       r.is_subtotal, r.subtotal_of, r.sign
  from report_groups r
  join entities e on e.id = r.entity_id and e.slug = 'rbjv'
 cross join (select id from entities where slug = 'group') g;

-- ---------- intercompany ----------

-- Balances between group companies. Marked on the account rather than guessed
-- at report time, so the client can correct a name-based guess in one place.
alter table accounts add column is_intercompany boolean not null default false;

update accounts
   set is_intercompany = true
 where name ~* '\yinter[\s-]*(company|concern|co\.|group)\y';

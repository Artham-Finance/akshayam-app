-- ============================================================
-- Reporting entities that are a slice, not a company.
--
-- The group consolidates two whole companies. RAJA (GIFT + AIF) is a different
-- animal: one partner's book, made of all of Akshayam and RBJV's AIF vertical
-- only. It is not a consolidation and must never be one - the group already
-- counts both companies in full, and folding RAJA in would count them twice.
--
-- parent_id could say "these companies belong to that group" but not "this
-- vertical of that company", and a company cannot have two parents anyway.
-- Membership therefore moves to its own table, with an optional vertical:
--
--   group  (rbjv, null) (akshayam, null)      whole companies
--   raja   (rbjv, AIF)  (akshayam, GIFT)      one vertical of each
--
-- Vertical ids are unique across companies, so a slice is expressed downstream
-- as a single "vertical_id = any(...)" on top of the usual entity filter.
-- ============================================================

create table entity_members (
  id               serial primary key,
  entity_id        int not null references entities(id) on delete cascade,
  member_entity_id int not null references entities(id) on delete cascade,
  -- null means the whole company
  vertical_id      int references verticals(id) on delete cascade
);

-- A surrogate key, because the natural one contains a nullable column and a
-- composite primary key would force every whole-company row to name a vertical.
-- coalesce keeps "the whole company" a single distinct row.
create unique index entity_members_unique_idx
  on entity_members (entity_id, member_entity_id, coalesce(vertical_id, 0));
create index entity_members_lookup_idx on entity_members (entity_id);

-- Only a consolidation eliminates intercompany balances. A slice holds no
-- intercompany accounts (they carry no reporting tag) and is not the whole of
-- anything, so eliminating against it would be meaningless.
alter table entities add column consolidates boolean not null default false;

update entities set consolidates = true where slug = 'group';

insert into entity_members (entity_id, member_entity_id, vertical_id)
select g.id, m.id, null
  from entities g, entities m
 where g.slug = 'group' and m.slug in ('rbjv', 'akshayam');

alter table entities drop column parent_id;

-- ---------- RAJA (GIFT + AIF) ----------

insert into entities (slug, name, currency, fy_start_month)
values ('raja', 'RAJA (GIFT + AIF)', 'INR', 4);

insert into entity_members (entity_id, member_entity_id, vertical_id)
select r.id, v.entity_id, v.id
  from entities r
  join verticals v on true
  join entities e on e.id = v.entity_id
 where r.slug = 'raja'
   and ((e.slug = 'rbjv' and v.code = 'AIF') or (e.slug = 'akshayam' and v.code = 'GIFT'));

-- A slice reports the same statements, so it needs the same layout.
insert into report_groups
  (entity_id, statement, code, name, parent_code, sort_order, is_subtotal, subtotal_of, sign)
select r.id, g.statement, g.code, g.name, g.parent_code, g.sort_order,
       g.is_subtotal, g.subtotal_of, g.sign
  from report_groups g
  join entities src on src.id = g.entity_id and src.slug = 'rbjv'
 cross join (select id from entities where slug = 'raja') r;

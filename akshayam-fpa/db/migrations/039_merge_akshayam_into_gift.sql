-- ============================================================
-- Akshayam runs a single book, so it should have one vertical: GIFT.
--
-- On deployments where Akshayam data was uploaded before 021/037 seeded the
-- canonical code 'GIFT' vertical, resolveVerticals created its own
-- "GIFT and Support" vertical (needs_review, code = the raw tag) for the
-- postings, and 021/037 then added a *separate* code 'GIFT' vertical for the
-- budget. The Budget vs Actual line splits in two - budget on one, actuals on
-- the other, each showing the other half as zero.
--
-- This folds every non-'GIFT' Akshayam vertical into 'GIFT': re-point every
-- table that carries a vertical, move RAJA's membership, drop the duplicates
-- (their aliases and headcount cascade), and leave an alias so a future upload
-- of the same tag lands on GIFT directly. A total no-op where Akshayam already
-- has just the one vertical.
-- ============================================================

do $$
declare
  ak   int := (select id from entities where slug = 'akshayam');
  keep int;
  raws text[];
begin
  if ak is null then return; end if;

  select id into keep
    from verticals where entity_id = ak and code = 'GIFT'
   order by id limit 1;
  if keep is null then return; end if;

  perform 1 from verticals where entity_id = ak and id <> keep;
  if not found then return; end if;   -- only GIFT exists, nothing to merge

  select array_agg(code) into raws
    from verticals where entity_id = ak and id <> keep;

  update gl_entries           set vertical_id   = keep where entity_id = ak and vertical_id   is not null and vertical_id   <> keep;
  update invoice_lines        set vertical_id   = keep where entity_id = ak and vertical_id   is not null and vertical_id   <> keep;
  update invoice_register     set vertical_hint = keep where entity_id = ak and vertical_hint is not null and vertical_hint <> keep;
  update credit_notes         set vertical_id   = keep where entity_id = ak and vertical_id   is not null and vertical_id   <> keep;
  update credit_note_register set vertical_hint = keep where entity_id = ak and vertical_hint is not null and vertical_hint <> keep;
  update payments             set vertical_id   = keep where entity_id = ak and vertical_id   is not null and vertical_id   <> keep;
  update payment_allocations  set vertical_id   = keep where entity_id = ak and vertical_id   is not null and vertical_id   <> keep;
  update ar_open_items        set vertical_id   = keep where entity_id = ak and vertical_id   is not null and vertical_id   <> keep;
  update retainer_revenue     set vertical_id   = keep where entity_id = ak and vertical_id   is not null and vertical_id   <> keep;

  delete from budgets
   where entity_id = ak
     and vertical_id in (select id from verticals where entity_id = ak and id <> keep);

  update entity_members em set vertical_id = keep
   where em.vertical_id in (select id from verticals where entity_id = ak and id <> keep)
     and not exists (
       select 1 from entity_members e2
        where e2.entity_id = em.entity_id
          and e2.member_entity_id = em.member_entity_id
          and e2.vertical_id = keep);
  delete from entity_members
   where vertical_id in (select id from verticals where entity_id = ak and id <> keep);

  delete from verticals where entity_id = ak and id <> keep;   -- cascades aliases + headcount

  update verticals set needs_review = false, name = 'GIFT and Support' where id = keep;

  if raws is not null then
    insert into vertical_aliases (entity_id, raw_code, vertical_id)
    select ak, unnest(raws), keep
    on conflict (entity_id, raw_code) do nothing;
  end if;
end $$;

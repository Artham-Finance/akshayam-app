-- ============================================================
-- RAJA's GIFT member row, re-checked after 037 guarantees the vertical.
--
-- 036 adds the RAJA <- Akshayam/GIFT entity_members row, but it can only do so
-- if Akshayam's GIFT vertical exists when it runs. On a deployment where 021
-- was recorded as applied without actually creating GIFT, 036 finds nothing and
-- is a silent no-op - and 036 will not re-run. 037 (the migration right before
-- this one) force-creates GIFT, so re-asserting 036's insert here, after 037,
-- fixes RAJA on that deployment in a single db:migrate.
--
-- A no-op wherever 036 already succeeded.
-- ============================================================

insert into entity_members (entity_id, member_entity_id, vertical_id)
select r.id, ak.id, v.id
  from entities r
  join entities ak on ak.slug = 'akshayam'
  join verticals v on v.entity_id = ak.id and v.code = 'GIFT'
 where r.slug = 'raja'
   and not exists (
     select 1 from entity_members x
      where x.entity_id = r.id
        and x.member_entity_id = ak.id
        and x.vertical_id = v.id);

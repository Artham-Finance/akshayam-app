-- ============================================================
-- The GIFT half of RAJA (GIFT + AIF), which a one-pass install came up without.
--
-- 012_entity_members builds RAJA's membership by joining to the verticals that
-- exist when it runs: RBJV's AIF, and Akshayam's GIFT. But 002 seeds only
-- RBJV's ten verticals - Akshayam's GIFT is not created until 021 seeds it (or
-- a GIFT-tagged Akshayam file is uploaded), and both land after 012. On a
-- database where every migration runs in one pass against an empty schema, 012
-- therefore inserts only the AIF row, and RAJA reports as RBJV's AIF alone -
-- one vertical, one company, half the book.
--
-- This laptop's database happened to have GIFT already (its migrations were
-- re-run after the first uploads), so RAJA is correct here and wrong on a
-- fresh deployment. Add the missing row now that 021 guarantees GIFT exists;
-- safe where 012 already created it.
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

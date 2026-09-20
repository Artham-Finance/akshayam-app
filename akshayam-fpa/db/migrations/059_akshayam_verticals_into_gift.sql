-- ============================================================
-- Akshayam has one real vertical, GIFT and Support - everything the company
-- does is GIFT. Any other vertical registered under Akshayam is not a second
-- business line; it is a tag that failed to match GIFT during some upload
-- and was given a vertical of its own rather than dropped (the create-new
-- fallback in resolveVerticals, src/lib/ingest.ts - now closed for any
-- single-vertical entity, this migration cleans up what it already did).
--
-- The concrete case seen in production: a "Common" tag became Akshayam's own
-- "COMMON" vertical, which then shared RBJV's own COMMON vertical *code* -
-- Team Cost's budget table (TEAM_COST_ANNUAL_BUDGET, src/lib/reports/
-- team-cost.ts) is keyed by code alone, so Akshayam's COMMON silently
-- inherited RBJV's COMMON budget figures. Not a one-off: any tag that failed
-- to match could have created another one, so every vertical Akshayam has
-- other than GIFT is folded into it here, whatever it is called.
--
-- Every table that carries a vertical_id is repointed from the stray
-- vertical to GIFT before the stray row is removed. Three of them have a
-- unique constraint that includes vertical_id, so a stray row is dropped
-- first wherever GIFT already has one for the same key - GIFT is the
-- long-standing vertical, so its own figure is the one kept.
-- ============================================================

do $$
declare
  akshayam_id integer;
  gift_id integer;
  stray_id integer;
begin
  select id into akshayam_id from entities where slug = 'akshayam';
  if akshayam_id is null then
    return;
  end if;

  select id into gift_id from verticals
   where entity_id = akshayam_id and upper(code) = 'GIFT';
  if gift_id is null then
    return;
  end if;

  for stray_id in
    select id from verticals where entity_id = akshayam_id and id <> gift_id
  loop
    -- budgets: unique on (vertical_id, entity_id, fy_start_year, measure).
    delete from budgets b
     where b.vertical_id = stray_id
       and exists (
             select 1 from budgets g
              where g.vertical_id = gift_id and g.entity_id = b.entity_id
                and g.fy_start_year = b.fy_start_year and g.measure = b.measure);
    update budgets set vertical_id = gift_id where vertical_id = stray_id;

    -- dsc_token_count: unique on (entity_id, month, vertical_id).
    delete from dsc_token_count d
     where d.vertical_id = stray_id
       and exists (
             select 1 from dsc_token_count g
              where g.vertical_id = gift_id and g.entity_id = d.entity_id and g.month = d.month);
    update dsc_token_count set vertical_id = gift_id where vertical_id = stray_id;

    -- vertical_headcount: unique on (vertical_id, fy_start_year, month).
    delete from vertical_headcount h
     where h.vertical_id = stray_id
       and exists (
             select 1 from vertical_headcount g
              where g.vertical_id = gift_id and g.fy_start_year = h.fy_start_year and g.month = h.month);
    update vertical_headcount set vertical_id = gift_id where vertical_id = stray_id;

    -- No conflicting unique key on vertical_id in any of these.
    update ar_open_items            set vertical_id = gift_id where vertical_id = stray_id;
    update credit_notes             set vertical_id = gift_id where vertical_id = stray_id;
    update entity_members           set vertical_id = gift_id where vertical_id = stray_id;
    update gl_entries                set vertical_id = gift_id where vertical_id = stray_id;
    update invoice_lines            set vertical_id = gift_id where vertical_id = stray_id;
    update payment_allocations      set vertical_id = gift_id where vertical_id = stray_id;
    update payments                 set vertical_id = gift_id where vertical_id = stray_id;
    update reimbursement_bill_lines set vertical_id = gift_id where vertical_id = stray_id;
    update retainer_revenue         set vertical_id = gift_id where vertical_id = stray_id;
    update revenue_transfer_entries set vertical_id = gift_id where vertical_id = stray_id;
    update tds_entries              set vertical_id = gift_id where vertical_id = stray_id;
    -- raw_code + entity_id is unique, not vertical_id - repointing which
    -- vertical an existing alias resolves to cannot collide with itself.
    update vertical_aliases         set vertical_id = gift_id where vertical_id = stray_id;

    delete from verticals where id = stray_id;
  end loop;
end $$;

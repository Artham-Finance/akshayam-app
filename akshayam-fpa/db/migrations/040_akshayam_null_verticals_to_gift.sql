-- ============================================================
-- Akshayam is one book: every posting and receipt is GIFT, including the ones
-- that came in untagged. attributeSoleVertical does this after each upload, but
-- only when Akshayam has exactly one active, confirmed vertical - which it did
-- not while 039's duplicate was around, so untagged rows were left null and
-- showed on Budget vs Actual as "Not attributed to a vertical".
--
-- 039 has now folded Akshayam back to the single GIFT vertical, so backfill
-- every remaining null. A no-op on a database that was always single-vertical,
-- and future uploads keep it this way through attributeSoleVertical.
-- ============================================================

do $$
declare
  ak   int := (select id from entities where slug = 'akshayam');
  gift int;
begin
  if ak is null then return; end if;

  select id into gift from verticals where entity_id = ak and code = 'GIFT' order by id limit 1;
  if gift is null then return; end if;

  -- only when GIFT is genuinely the sole business line
  if (select count(*) from verticals where entity_id = ak and is_active and not needs_review) <> 1 then
    return;
  end if;

  update gl_entries           set vertical_id   = gift where entity_id = ak and vertical_id   is null;
  update invoice_lines        set vertical_id   = gift where entity_id = ak and vertical_id   is null;
  update invoice_register     set vertical_hint = gift where entity_id = ak and vertical_hint is null;
  update credit_notes         set vertical_id   = gift where entity_id = ak and vertical_id   is null;
  update credit_note_register set vertical_hint = gift where entity_id = ak and vertical_hint is null;
  update payments             set vertical_id   = gift where entity_id = ak and vertical_id   is null;
  update payment_allocations  set vertical_id   = gift where entity_id = ak and vertical_id   is null;
  update ar_open_items        set vertical_id   = gift where entity_id = ak and vertical_id   is null;
  update retainer_revenue     set vertical_id   = gift where entity_id = ak and vertical_id   is null;
end $$;

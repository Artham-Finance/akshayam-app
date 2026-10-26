-- ============================================================
-- Repair receipts stored twice.
--
-- Two uploads of the same company overlapping each rebuilt the receipt allocations without
-- seeing the other's rows, and every receipt was written twice: Collections read exactly
-- double the Customer Payments file (the ingest now takes a lock so it cannot recur - see
-- createUpload in src/lib/ingest.ts).
--
-- Allocations split each receipt over the invoices it settles, so a company's allocations
-- add up to its receipts. Where they add up to a good deal more (1.5 times or over) the
-- surplus is exact copies, and the copies are removed - one of each kept. A company whose
-- allocations tie to its receipts is left untouched.
-- ============================================================

do $$
declare
  e record;
  alloc_total numeric;
  pay_total numeric;
  removed integer;
begin
  for e in select id from entities loop
    select coalesce(sum(amount_base), 0) into alloc_total from payment_allocations where entity_id = e.id;
    select coalesce(sum(amount_base), 0) into pay_total from payments where entity_id = e.id;

    if pay_total > 0 and alloc_total >= pay_total * 1.5 then
      delete from payment_allocations
       where id in (
         select id from (
           select id,
                  row_number() over (
                    partition by payment_id, coalesce(invoice_number, ''), vertical_id,
                                 is_reimbursement, amount_base, basis
                    order by id
                  ) as rn
             from payment_allocations
            where entity_id = e.id
         ) d
          where d.rn > 1
       );
      get diagnostics removed = row_count;
      raise notice 'entity %: allocations % against receipts % - removed % duplicate row(s)', e.id, alloc_total, pay_total, removed;
    end if;
  end loop;
end $$;

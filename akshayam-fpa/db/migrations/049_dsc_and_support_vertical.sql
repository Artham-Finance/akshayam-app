-- ============================================================
-- "DSC and support" - a new RBJV vertical, carved out of Common.
--
-- Common (also partners contribution) incl other services holds three things:
-- the partners' own contribution, shared/common cost, and the "other services"
-- line, which is Vaithy's book - buying and selling digital-signature (DSC)
-- tokens. That last part becomes its own vertical so revenue, collections and
-- receivables can be read for it on their own.
--
-- The reporting tag is "Other services", so the vertical alias is re-pointed:
-- every future upload tagged that way lands on DSC, including the general
-- ledger. Rows already loaded carry no raw tag, only a vertical_id, so the
-- historical split uses the salesperson - "Vaithy - Other services" - on the
-- three tables the Vertical Performance pages read (invoices, AR, and the
-- payments / credit notes that hang off those invoices).
--
-- Budget for DSC is nil by decision; nothing is seeded in any budget table.
-- ============================================================

insert into verticals (entity_id, code, name, sort_order, is_active, needs_review)
select e.id, 'DSC', 'DSC and support', 95, true, false
  from entities e
 where e.slug = 'rbjv'
   and not exists (
     select 1 from verticals v where v.entity_id = e.id and v.code = 'DSC'
   );

-- Future uploads: "Other services" -> DSC, not Common.
update vertical_aliases
   set vertical_id = (
     select v.id from verticals v
      join entities e on e.id = v.entity_id
     where e.slug = 'rbjv' and v.code = 'DSC'
   )
 where entity_id = (select id from entities where slug = 'rbjv')
   and lower(btrim(raw_code)) = 'other services';

-- Historical rows: move Vaithy's book off Common.
do $$
declare
  rbjv int := (select id from entities where slug = 'rbjv');
  dsc  int := (select v.id from verticals v where v.entity_id = rbjv and v.code = 'DSC');
  common int := (select v.id from verticals v where v.entity_id = rbjv and v.code = 'COMMON');
  sp text := 'Vaithy - Other services';
begin
  update invoice_lines
     set vertical_id = dsc
   where entity_id = rbjv and vertical_id = common and salesperson = sp;

  update ar_open_items
     set vertical_id = dsc
   where entity_id = rbjv and vertical_id = common and salesperson = sp;

  -- Credit notes and payments carry no salesperson - follow their invoice.
  update credit_notes
     set vertical_id = dsc
   where entity_id = rbjv and vertical_id = common
     and invoice_number in (
       select invoice_number from invoice_lines
        where entity_id = rbjv and vertical_id = dsc and invoice_number is not null
     );

  update payments
     set vertical_id = dsc
   where entity_id = rbjv and vertical_id = common
     and invoice_number in (
       select invoice_number from invoice_lines
        where entity_id = rbjv and vertical_id = dsc and invoice_number is not null
     );

  update payment_allocations
     set vertical_id = dsc
   where entity_id = rbjv and vertical_id = common
     and invoice_number in (
       select invoice_number from invoice_lines
        where entity_id = rbjv and vertical_id = dsc and invoice_number is not null
     );
end $$;

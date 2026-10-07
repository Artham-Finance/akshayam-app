-- ============================================================
-- OSB expenses: costs paid outside the books - an event, a team outing - that
-- never reach Zoho and so have no ledger entry to read. The firm keeps them in
-- a small hand-made workbook: the event's name, then one row per vertical with
-- an amount under the month it belongs to.
--
-- Shown on the P&L as its own line straight after "Reimbursable Costs
-- Recovered (net)", inside EBITDA, and on Budget vs Actual the same way. No
-- budget is planned for it, so that side is nil. Attributed to the vertical the
-- sheet names, so a vertical's own P&L and the cost apportionment carry it.
--
-- Same shape as OSB Revenue (026 / 028): a genuine account and report group
-- per entity - accounts and report_groups are held per entity, so the Group and
-- every slice need their own copy or the row would be dropped silently.
-- ============================================================

alter type upload_kind add value if not exists 'osb_expenses';

create table osb_expense_entries (
  id          serial primary key,
  entity_id   integer not null references entities(id),
  upload_id   integer not null references uploads(id),
  -- null only where the sheet's label matches no vertical; the loader refuses
  -- such a file rather than guess, so in practice always set
  vertical_id integer references verticals(id),
  -- the first day of the month the cost belongs to
  month       date not null,
  -- the title on the sheet - "Born to win" - so two events in one month stay apart
  particulars text not null,
  amount      numeric(14, 2) not null
);

create index osb_expense_entries_entity_month_idx
  on osb_expense_entries (entity_id, month);

insert into accounts (entity_id, name, zoho_type, statement, group_code, sort_order, is_mapped)
select e.id, 'OSB Expenses', 'Expense', 'pnl', 'osb_expenses', 65, true
  from entities e
 where not exists (select 1 from accounts a where a.entity_id = e.id and a.name = 'OSB Expenses');

insert into report_groups (entity_id, statement, code, name, sort_order, is_subtotal, sign)
select e.id, 'pnl', 'osb_expenses', 'OSB Expenses', 65, false, -1
  from entities e
 where not exists (
   select 1 from report_groups rg where rg.entity_id = e.id and rg.statement = 'pnl' and rg.code = 'osb_expenses');

update report_groups
   set subtotal_of = array_append(subtotal_of, 'osb_expenses')
 where statement = 'pnl' and code = 'ebitda'
   and not ('osb_expenses' = any(subtotal_of));

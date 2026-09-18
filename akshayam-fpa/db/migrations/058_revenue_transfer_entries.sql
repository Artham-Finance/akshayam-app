-- ============================================================
-- Revenue transferred to RBJV, take two.
--
-- 055_revenue_transfer_to_rbjv.sql read this off a sheet buried inside the
-- weekly Invoice Details workbook and deducted it from Akshayam's own
-- Revenue from Operations - which needed that sheet re-added to every export
-- to keep working, and it stopped being added. The firm's decision now: a
-- standalone upload of its own, shown as its own card between the P&L and
-- Common-size P&L rather than folded into the statement (it has no GL entry
-- of its own to justify sitting inside the ledger-derived P&L), and its
-- effect moved from the P&L to the vertical actuals GIFT is measured
-- against on Revenue and Collections - the portion passed to RBJV should not
-- read as Akshayam's own performance there either.
--
-- 055's column and account are left in place, unused: nothing reads
-- invoice_lines.is_revenue_transfer for the P&L any more (see
-- src/lib/reports/statements.ts and budget-pnl.ts), and the "Revenue
-- transferred to RBJV" account is harmless sitting idle. Dropping them is a
-- separate cleanup, not part of moving where this figure is read.
-- ============================================================

alter type upload_kind add value if not exists 'osb_entries';

create table revenue_transfer_entries (
  id              serial primary key,
  entity_id       integer not null references entities(id),
  upload_id       integer not null references uploads(id),
  vertical_id     integer references verticals(id),
  invoice_number  text not null,
  invoice_date    date not null,
  customer_name   text not null,
  salesperson_name text,
  amount          numeric(14, 2) not null,
  status          text
);

create index revenue_transfer_entries_entity_idx
  on revenue_transfer_entries (entity_id, invoice_date);

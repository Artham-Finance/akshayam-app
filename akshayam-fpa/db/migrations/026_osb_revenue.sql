-- ============================================================
-- Outside-books invoices: real client billings raised outside Zoho's normal
-- invoice flow, which the firm still wants counted as revenue of the
-- vertical that did the work, and carried through to collections or
-- receivables depending on whether they have been paid.
--
-- is_osb rather than a separate table: an OSB invoice needs to behave like
-- any other invoice everywhere revenue, collections and receivables already
-- read from invoice_lines/payments/ar_open_items, and a separate table would
-- mean teaching every one of those queries a second source. The one place
-- that genuinely cannot treat it like a normal invoice is the P&L, which is
-- tied to the ledger - an OSB invoice has no gl_entries behind it by
-- definition, so it gets its own line there instead (below).
--
-- Marked, not merely inserted, because commitInvoices/commitPayments both
-- replace their table's rows for whatever date range the new upload covers -
-- correct for a monthly Zoho re-export, wrong for a manually-entered invoice
-- that Zoho's export was never going to carry in the first place. The three
-- delete-and-replace statements in ingest.ts are updated alongside this
-- migration to leave is_osb rows alone.
-- ============================================================

alter table invoice_lines add column if not exists is_osb boolean not null default false;
alter table payments     add column if not exists is_osb boolean not null default false;
alter table ar_open_items add column if not exists is_osb boolean not null default false;

comment on column invoice_lines.is_osb is
  'Outside-books invoice: real revenue with no Zoho invoice or ledger entry behind it. Survives the normal delete-and-replace on re-upload.';
comment on column payments.is_osb is
  'Collection against an outside-books invoice - dated to the invoice date, since no real receipt exists to carry its own date.';
comment on column ar_open_items.is_osb is
  'An outside-books invoice still open. Re-stamped to each new AR snapshot''s as_of date rather than uploaded, since no Zoho export carries it.';

-- ---------- the P&L line ----------

-- A genuine account, not a synthetic row invented at query time: P&L drill-
-- down and the "needs mapping" screen both key off a real accounts row, and
-- OSB revenue should look no different to either than any other line.
insert into accounts (entity_id, name, zoho_type, statement, group_code, sort_order, is_mapped)
select e.id, 'OSB Revenue', 'Income', 'pnl', 'osb_revenue', 15, true
  from entities e where e.slug = 'rbjv'
    and not exists (select 1 from accounts a where a.entity_id = e.id and a.name = 'OSB Revenue');

insert into report_groups (entity_id, statement, code, name, sort_order, is_subtotal, sign)
select e.id, 'pnl', 'osb_revenue', 'OSB Revenue', 15, false, 1
  from entities e where e.slug = 'rbjv'
    and not exists (
      select 1 from report_groups rg where rg.entity_id = e.id and rg.statement = 'pnl' and rg.code = 'osb_revenue');

-- Rolled into Gross Profit exactly where Revenue from Operations already is,
-- so it reaches EBITDA, EBIT, PBT and PAT through the same chain rather than
-- needing its own copy of it.
update report_groups
   set subtotal_of = array_append(subtotal_of, 'osb_revenue')
  from entities e
 where report_groups.entity_id = e.id and e.slug = 'rbjv'
   and report_groups.statement = 'pnl' and report_groups.code = 'gross_profit'
   and not ('osb_revenue' = any(report_groups.subtotal_of));

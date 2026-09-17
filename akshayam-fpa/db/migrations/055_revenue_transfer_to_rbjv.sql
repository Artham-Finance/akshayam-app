-- ============================================================
-- Revenue transferred to RBJV: invoices Akshayam raises (through GIFT) for
-- work RBJV's own team actually serves the client on, where a portion of
-- the invoice value is passed on to RBJV. The client relationship and the
-- ledger posting are Akshayam's - the invoice is a real one, with real
-- gl_entries behind it, so this is not outside-books revenue - but the
-- whole invoice value is not really Akshayam's own revenue either.
--
-- Hand-maintained on its own sheet in the same Invoice Details workbook,
-- exactly like the OSB sheet (026_osb_revenue.sql) - a fixed convention,
-- not a Zoho report shape, replaced wholesale on every upload that carries
-- it. Where OSB adds revenue with no ledger behind it, this deducts revenue
-- that already has one, so it is marked and summed the same way but the
-- amount is negated when it reaches the statement.
--
-- Scoped to Akshayam's own standalone statement only, not the Group's
-- consolidated one: the client's payment is genuine third-party revenue for
-- the group as a whole regardless of which company's team did the work, and
-- there is no matching addition on RBJV's own books to offset a deduction
-- here - RBJV recognises this work through its own invoicing, unrelated to
-- this feed.
-- ============================================================

alter table invoice_lines add column if not exists is_revenue_transfer boolean not null default false;

comment on column invoice_lines.is_revenue_transfer is
  'A portion of this Akshayam invoice passed on to RBJV - deducted from Revenue from Operations on Akshayam''s own statement, not added. Survives the normal delete-and-replace on re-upload.';

-- A genuine account, not a synthetic row invented at query time - same
-- reasoning as OSB Revenue's own account in 026_osb_revenue.sql. Given the
-- 'revenue' group_code (rather than a group of its own), so it lands as a
-- deduction line directly under Revenue from Operations and reduces that
-- group's own total, rather than sitting beside it the way OSB Revenue does.
insert into accounts (entity_id, name, zoho_type, statement, group_code, sort_order, is_mapped)
select e.id, 'Revenue transferred to RBJV', 'Income', 'pnl', 'revenue', 11, true
  from entities e where e.slug = 'akshayam'
    and not exists (
      select 1 from accounts a where a.entity_id = e.id and a.name = 'Revenue transferred to RBJV');

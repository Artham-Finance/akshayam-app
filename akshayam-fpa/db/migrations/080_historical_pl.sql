-- ============================================================
-- Historical monthly P&L: the accountant's own Profit and Loss, one sheet per month, uploaded
-- for years the general ledger is not (or no longer) the record. It feeds the Performance tab
-- of Trend Analysis, which compares a month / quarter / half year with the same period of the
-- years before. A month that is here is read from here; a month that is not comes from the
-- ledger.
--
-- Only the totals the comparison needs are kept as columns; every account's amount for the
-- month is kept in `lines` so a later screen can drill into it without another upload.
--
--   revenue     operating income from services (interest income and "other income" are
--               set against `other_net`, as the ledger's Other Income group is)
--   expenses    cost of goods sold + operating expense, less any income-tax provision
--   other_net   non-operating income less non-operating expense, plus interest/other income
--   tax_booked  the income-tax provision that was inside operating expense - taken out of
--               expenses, because the comparison is struck before tax and the tax is
--               applied at the company's rate (35% for RBJV) on the period's profit
--   reported_net  the sheet's own "Net Profit/Loss", to check the parts against
--
--   profit before tax = revenue - expenses + other_net
-- ============================================================

alter type upload_kind add value if not exists 'historical_pl';

create table historical_pl_months (
  entity_id    integer not null references entities(id),
  -- first day of the month
  month        date    not null,
  upload_id    integer not null references uploads(id) on delete cascade,
  sheet_name   text,
  revenue      numeric(16,2) not null,
  expenses     numeric(16,2) not null,
  other_net    numeric(16,2) not null,
  tax_booked   numeric(16,2) not null default 0,
  reported_net numeric(16,2),
  lines        jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  primary key (entity_id, month)
);

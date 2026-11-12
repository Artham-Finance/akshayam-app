-- ============================================================
-- Bad debts written off: a list the accountant keeps (the Bad Debts account's transactions), one row
-- per invoice written off, uploaded for RBJV and for Akshayam ("Bad debts written off" on the Upload
-- tab).
--
-- It is read in two places: the Receivables page carries a card of what has been written off in the
-- year (and the list behind it), and the Collections page's Actual card carries a note of what was
-- written off for the vertical. RBJV's sheet names the vertical of each row; Akshayam's has none, so
-- `vertical_id` is null there and the rows belong to the company as a whole.
--
-- A file replaces exactly the dates it covers and leaves every other date alone, so a cumulative
-- sheet can be sent again and a month's sheet can be sent on its own.
-- ============================================================

alter type upload_kind add value if not exists 'bad_debts';

create table bad_debts (
  id             serial primary key,
  entity_id      integer not null references entities(id),
  upload_id      integer not null references uploads(id) on delete cascade,
  written_off_on date    not null,
  -- the invoice (or reimbursement invoice, "RI-...") written off
  reference      text    not null,
  customer       text,
  vertical_id    integer references verticals(id),
  amount         numeric(16,2) not null,
  sheet_row      integer,
  created_at     timestamptz not null default now()
);

create index bad_debts_entity_date_idx on bad_debts (entity_id, written_off_on);

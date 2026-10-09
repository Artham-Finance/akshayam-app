-- ============================================================
-- Weekly ratings: what each vertical head commits to before a week begins,
-- kept so the week can be rated against it afterwards.
--
-- At the Saturday meeting the head commits an amount for the coming week -
-- revenue to be billed, collection to be received, or receivables to be
-- recovered - customer by customer. The amounts freeze at the end of the day
-- they are first keyed (`entered_on`), so a commitment cannot be quietly
-- improved once the week's figures are known; an admin can reopen one for a
-- day (`reopened_on`). "Achieved?" is the outcome, said afterwards, so it
-- stays editable.
--
-- Actuals are never stored here: they flow from the ledger, the payments and
-- the invoices every time the screen is read.
-- ============================================================

create table weekly_commitments (
  id           serial primary key,
  entity_id    integer not null references entities(id),
  vertical_id  integer not null references verticals(id),
  measure      text    not null check (measure in ('revenue', 'collection', 'receivables')),
  -- the Saturday the week ends on; the week runs from the Sunday before
  week_end     date    not null,
  -- the Saturday meeting the commitment was made at
  meeting_date date    not null,
  -- the (Indian) day it was first keyed; the amounts freeze at its end
  entered_on   date    not null,
  -- the one day an admin has reopened it for
  reopened_on  date,
  achieved     text    check (achieved in ('yes', 'partly', 'no')),
  remarks      text,
  created_by   integer references users(id),
  updated_by   integer references users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (vertical_id, week_end, measure)
);

create index weekly_commitments_week_idx on weekly_commitments (week_end, measure);

create table weekly_commitment_lines (
  id            serial primary key,
  commitment_id integer not null references weekly_commitments(id) on delete cascade,
  customer_name text    not null,
  amount        numeric(14, 2) not null
);

create index weekly_commitment_lines_commitment_idx on weekly_commitment_lines (commitment_id);

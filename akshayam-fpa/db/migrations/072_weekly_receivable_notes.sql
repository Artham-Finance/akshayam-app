-- ============================================================
-- MAK meeting - Receivables: the notes the vertical head keeps week by week.
--
-- Two kinds, both against a customer of a vertical:
--
--   over180   a receivable older than 180 days. In the week it is discussed the
--             head writes what they commit to (`commitment`); in the weeks that
--             follow they review it (`review`) and say whether it was achieved.
--             The commitment's text can be changed until the end of the day it
--             was first keyed (`entered_on`), like every commitment on the
--             screen; the review and the outcome are said afterwards and stay
--             open.
--   tds       the follow-up action on a customer's TDS receivable that Form 26AS
--             does not yet show (`remark`). Always open.
--
-- Nothing else is stored: the receivables, the top customers, the invoices and
-- the TDS figures are read from the AR snapshot, the ledger and Form 26AS each
-- time the screen opens.
-- ============================================================

create table weekly_receivable_notes (
  id          serial primary key,
  entity_id   integer not null references entities(id),
  vertical_id integer not null references verticals(id),
  -- the Saturday the week ends on, as for the commitments
  week_end    date    not null,
  customer    text    not null,
  kind        text    not null check (kind in ('over180', 'tds')),
  commitment  text,
  -- the (Indian) day the commitment was first keyed; its text freezes at its end
  entered_on  date    not null,
  review      text,
  achieved    text    check (achieved in ('yes', 'partly', 'no')),
  remark      text,
  updated_by  integer references users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (vertical_id, week_end, customer, kind)
);

create index weekly_receivable_notes_lookup_idx
  on weekly_receivable_notes (vertical_id, kind, week_end);

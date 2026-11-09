-- ============================================================
-- TDS corrections: one-off changes the client asks for, kept in a hand-maintained sheet and
-- uploaded for RBJV ("TDS Corrections" on the Upload tab).
--
-- Today the one kind is moving a customer's TDS from one vertical to another - a customer
-- that has been shifted, say, from GADD to ECM. The sheet only ever grows, so every upload
-- replaces the whole list: a row removed from the sheet stops having effect.
--
-- The corrections are applied when the MAK meeting's TDS receivables tab is read (see
-- src/lib/reports/tds-receivables.ts); the TDS rows themselves (074) are not edited, so the
-- sheet stays the single place the change is made and undone.
-- ============================================================

alter type upload_kind add value if not exists 'tds_corrections';

create table tds_corrections (
  id               serial primary key,
  entity_id        integer not null references entities(id),
  upload_id        integer not null references uploads(id) on delete cascade,
  customer         text    not null,
  from_vertical_id integer not null references verticals(id),
  to_vertical_id   integer not null references verticals(id),
  -- "FY24-25"; null: every year the customer is held under the from-vertical
  fy               text,
  -- the line of instruction above the table in the sheet, and the row it was on
  instruction      text,
  sheet_row        integer,
  created_at       timestamptz not null default now()
);

create index tds_corrections_entity_idx on tds_corrections (entity_id, id);

-- ============================================================
-- MAK meeting - Receivables: a second ageing bucket.
--
-- The head commits against two buckets of overdue receivables, kept apart: those
-- over 90 days (up to 180) - kind 'over90' - and those over 180 days - 'over180'.
-- The notes are the same shape for both; only the kind differs.
-- ============================================================

alter table weekly_receivable_notes drop constraint weekly_receivable_notes_kind_check;
alter table weekly_receivable_notes
  add constraint weekly_receivable_notes_kind_check check (kind in ('over90', 'over180', 'tds'));

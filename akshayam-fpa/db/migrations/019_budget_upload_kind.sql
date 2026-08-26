-- ============================================================
-- The planning workbook as an upload.
--
-- The budgeted P&L and the Other-expenses breakdown were loadable only from
-- the terminal, which was fine on one laptop and useless once the app runs on
-- a server: a fresh deployment came up with live actuals and no budget beside
-- them, and no way in the interface to fix that.
-- ============================================================

alter type upload_kind add value if not exists 'budget';

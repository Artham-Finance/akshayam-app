-- ============================================================
-- Weekly ratings joins the report pages a person's grant can cover
-- (user_report_access, 064). Like every other report tab it is something an
-- admin hands out per person, on top of which companies and verticals they
-- may see - a vertical head's own slice already limits the rows to theirs.
--
-- Backfilled for every existing user, so nothing changes for anyone signed
-- in today until an admin unchecks it.
-- ============================================================

insert into user_report_access (user_id, report_code)
select u.id, 'weekly' from users u
on conflict do nothing;

-- ============================================================
-- Which report pages a person may see, on top of which companies.
--
-- A team lead's login already only shows the tabs their vertical-slice
-- entity makes sense for (Core Financials narrows to Profit & Loss, and
-- Vertical Performance is Revenue/Receivables/Collections/Scorecard) - this
-- is a finer per-person grant on top of that, so an admin can hand out any
-- subset of those five rather than all-or-nothing.
--
-- Backfilled for every existing user against every code, so nothing changes
-- for anyone signed in today until an admin unchecks something.
-- ============================================================

create table user_report_access (
  user_id     int  not null references users(id) on delete cascade,
  report_code text not null,
  primary key (user_id, report_code)
);

insert into user_report_access (user_id, report_code)
select u.id, code
  from users u
  cross join unnest(array['pnl','revenue','receivables','collections','scorecard']) as code
on conflict do nothing;

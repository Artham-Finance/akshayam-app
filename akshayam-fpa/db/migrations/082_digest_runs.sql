-- ============================================================
-- The Monday and Friday evening email update: a log of each run.
--
-- A scheduled run claims its day here before it sends anything, so a restart of
-- the app in the middle of the evening, or a second process, cannot send the same
-- update twice. A manual run (an admin sending a test) is logged but never claims
-- the day.
-- ============================================================

create table digest_runs (
  id          serial primary key,
  run_date    date        not null,
  -- 'scheduled' (the Monday / Friday timer) or 'manual' (an admin's test send)
  trigger     text        not null check (trigger in ('scheduled', 'manual')),
  status      text        not null default 'running' check (status in ('running', 'done', 'failed')),
  sent        int         not null default 0,
  failed      int         not null default 0,
  skipped     int         not null default 0,
  detail      jsonb       not null default '{}'::jsonb,
  started_at  timestamptz not null default now(),
  finished_at timestamptz
);

-- One scheduled run a day.
create unique index digest_runs_scheduled_day_idx
  on digest_runs (run_date) where trigger = 'scheduled';

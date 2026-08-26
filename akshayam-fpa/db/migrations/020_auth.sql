-- ============================================================
-- Authentication + role-based authorisation.
--
-- 001_init sketched users and sessions but nothing ever read them, so this
-- reshapes both rather than layering onto a guess that was never exercised.
--
-- Two axes decide what someone may do, and they are deliberately separate:
--
--   role    what kind of thing you may do   (view / contribute / administer)
--   grants  whose books you may do it to    (RBJV, Akshayam, group, RAJA)
--
-- Collapsing them into one column was the original sketch (users.entity_id)
-- and it cannot express "a contributor on Akshayam who may also read the
-- group", which is the ordinary case here. Roles stay a single column because
-- they are genuinely one-of; entity access becomes a join table because it is
-- genuinely many.
-- ============================================================

-- ---------- roles ----------

-- A check constraint rather than an enum: the set is small and stable, but
-- adding a role to an enum needs its own migration and locks the type, whereas
-- widening a check is a one-line alter.
alter table users
  drop constraint if exists users_role_check;

alter table users
  alter column role set default 'viewer',
  add constraint users_role_check check (role in ('admin', 'contributor', 'viewer'));

-- Deactivation rather than deletion: uploads reference uploaded_by, and a
-- departed colleague's name should stay legible against the rows they loaded.
alter table users
  add column if not exists is_active boolean not null default true,
  add column if not exists must_change_password boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();

-- ---------- entity grants ----------

create table user_entities (
  user_id   int not null references users(id)    on delete cascade,
  entity_id int not null references entities(id) on delete cascade,
  primary key (user_id, entity_id)
);
create index user_entities_user_idx on user_entities (user_id);

-- Carry over anything the old single-entity column held, then retire it.
insert into user_entities (user_id, entity_id)
select id, entity_id from users where entity_id is not null
on conflict do nothing;

alter table users drop column if exists entity_id;

-- ---------- sessions ----------

-- Rebuilt, not altered. The old table used its primary key as the cookie
-- value, which means anyone who can read the table can mint a cookie for any
-- user. Instead the cookie carries a 256-bit random token and the database
-- keeps only its SHA-256, so a leaked dump cannot be replayed as a login.
drop table if exists sessions;

create table sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      int  not null references users(id) on delete cascade,
  -- hex sha256 of the token held in the browser cookie; never the token itself
  token_hash   text not null unique,
  issued_at    timestamptz not null default now(),
  expires_at   timestamptz not null,
  last_seen_at timestamptz not null default now(),
  user_agent   text,
  ip           text
);
create index sessions_user_idx    on sessions (user_id);
create index sessions_expiry_idx  on sessions (expires_at);

-- ---------- audit ----------

-- Who changed what, for the actions that alter reported figures. Financial
-- statements that anyone can silently re-map are worth less than ones where
-- the mapping has a name against it.
create table auth_audit (
  id         bigserial primary key,
  user_id    int references users(id) on delete set null,
  -- kept as text so a deleted user's actions stay readable
  actor      text,
  action     text not null,
  detail     jsonb not null default '{}'::jsonb,
  ip         text,
  created_at timestamptz not null default now()
);
create index auth_audit_created_idx on auth_audit (created_at desc);
create index auth_audit_user_idx    on auth_audit (user_id, created_at desc);

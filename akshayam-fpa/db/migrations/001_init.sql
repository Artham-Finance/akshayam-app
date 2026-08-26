-- ============================================================
-- Akshayam FP&A dashboard - core schema
-- Design notes:
--   * Every ingested row is owned by an upload. Re-uploading the
--     same kind+period supersedes the old upload and its rows, so
--     re-opened months self-correct instead of double-counting.
--   * accounts is the mapping layer: Zoho ledger names are joined
--     to a presentation hierarchy the client actually reads.
-- ============================================================

create extension if not exists pgcrypto;
create extension if not exists citext;

-- ---------- tenancy ----------

create table entities (
  id             serial primary key,
  slug           text not null unique,
  name           text not null,
  currency       text not null default 'INR',
  fy_start_month smallint not null default 4,        -- Indian FY: April
  created_at     timestamptz not null default now()
);

-- Business verticals (Zoho reporting tags). Discovered from uploads,
-- renamed/reordered by the user in settings.
create table verticals (
  id           serial primary key,
  entity_id    int  not null references entities(id) on delete cascade,
  code         text not null,                        -- short canonical code, e.g. CFC
  name         text not null,                        -- display name
  sort_order   int  not null default 0,
  is_active    boolean not null default true,
  -- true when the vertical was invented from an unrecognised tag rather than
  -- seeded, so it can be surfaced for the user to fold into a real one
  needs_review boolean not null default false,
  unique (entity_id, code)
);

-- Zoho reporting tags are free text and change between years. This maps every
-- raw tag ever seen onto a canonical vertical, so a rename in Zoho does not
-- fragment the history.
create table vertical_aliases (
  id          serial primary key,
  entity_id   int  not null references entities(id) on delete cascade,
  raw_code    text not null,
  vertical_id int  not null references verticals(id) on delete cascade,
  unique (entity_id, raw_code)
);

-- ---------- presentation hierarchy ----------

create type statement_kind as enum ('pnl', 'bs', 'cf', 'none');

-- Ordered line groups that make up each statement, e.g. for the P&L:
-- revenue -> direct_cost -> GROSS PROFIT -> employee_cost -> ... -> PAT
create table report_groups (
  id          serial primary key,
  entity_id   int not null references entities(id) on delete cascade,
  statement   statement_kind not null,
  code        text not null,
  name        text not null,
  parent_code text,
  sort_order  int  not null,
  is_subtotal boolean not null default false,        -- computed line, no accounts map here
  subtotal_of text[],                                -- group codes summed into this line
  sign        smallint not null default 1,           -- -1 flips natural sign for display
  unique (entity_id, statement, code)
);

-- ---------- chart of accounts / mapping layer ----------

create table accounts (
  id          serial primary key,
  entity_id   int  not null references entities(id) on delete cascade,
  code        text,                                  -- Zoho account code, if exported
  name        text not null,                         -- Zoho account name = the join key
  zoho_type   text,                                  -- Income / Expense / Bank / ...
  statement   statement_kind not null default 'none',
  group_code  text,                                  -- -> report_groups.code
  subgroup    text,                                  -- optional second level
  sort_order  int  not null default 0,
  cf_category text,                                  -- cash | non_cash_addback | wc_operating
                                                     -- | investing | financing | pnl
  is_mapped   boolean not null default false,        -- false => surfaced as "needs mapping"
  created_at  timestamptz not null default now(),
  unique (entity_id, name)
);
create index accounts_unmapped_idx on accounts (entity_id) where is_mapped = false;

-- ---------- uploads ----------

create type upload_kind   as enum ('gl', 'opening_tb', 'invoices', 'payments', 'ar_aging');
create type upload_status as enum ('pending', 'parsed', 'committed', 'failed', 'superseded');

create table uploads (
  id            serial primary key,
  entity_id     int  not null references entities(id) on delete cascade,
  kind          upload_kind not null,
  original_name text not null,
  stored_path   text,
  byte_size     bigint,
  sha256        text,
  period_start  date,
  period_end    date,
  row_count     int,
  status        upload_status not null default 'pending',
  notes         jsonb not null default '{}'::jsonb,  -- parser warnings, detected columns
  uploaded_by   int,
  created_at    timestamptz not null default now()
);
create index uploads_lookup_idx on uploads (entity_id, kind, status, period_start);

-- ---------- ledger ----------

create table gl_entries (
  id           bigserial primary key,
  entity_id    int  not null references entities(id) on delete cascade,
  upload_id    int  not null references uploads(id)  on delete cascade,
  txn_date     date not null,
  account_id   int  not null references accounts(id),
  vertical_id  int  references verticals(id),
  description  text,
  txn_type     text,
  txn_number   text,
  reference    text,
  contact_name text,
  debit        numeric(18,2) not null default 0,
  credit       numeric(18,2) not null default 0
);
create index gl_date_idx     on gl_entries (entity_id, txn_date);
create index gl_account_idx  on gl_entries (entity_id, account_id, txn_date);
create index gl_vertical_idx on gl_entries (entity_id, vertical_id, txn_date);

-- Prior-year closing trial balance: seeds the opening balance sheet.
create table opening_balances (
  id         serial primary key,
  entity_id  int  not null references entities(id) on delete cascade,
  upload_id  int  references uploads(id) on delete set null,
  as_of      date not null,
  account_id int  not null references accounts(id),
  debit      numeric(18,2) not null default 0,
  credit     numeric(18,2) not null default 0,
  unique (entity_id, as_of, account_id)
);

-- ---------- revenue / collections / receivables ----------

create table invoice_lines (
  id             bigserial primary key,
  entity_id      int  not null references entities(id) on delete cascade,
  upload_id      int  not null references uploads(id)  on delete cascade,
  invoice_number text not null,
  invoice_date   date not null,
  due_date       date,
  customer_name  text not null,
  vertical_id    int  references verticals(id),
  salesperson    text,
  item_name      text,
  currency       text not null default 'INR',
  exchange_rate  numeric(18,6) not null default 1,
  amount_base    numeric(18,2) not null default 0,   -- ex-tax, in entity currency (INR)
  total_base     numeric(18,2) not null default 0,   -- incl. tax, in entity currency
  status         text
);
create index invoice_date_idx     on invoice_lines (entity_id, invoice_date);
create index invoice_customer_idx on invoice_lines (entity_id, customer_name);

create table payments (
  id             bigserial primary key,
  entity_id      int  not null references entities(id) on delete cascade,
  upload_id      int  not null references uploads(id)  on delete cascade,
  payment_number text,
  payment_date   date not null,
  customer_name  text not null,
  invoice_number text,
  vertical_id    int  references verticals(id),
  currency       text not null default 'INR',
  amount_base    numeric(18,2) not null default 0,
  mode           text
);
create index payments_date_idx on payments (entity_id, payment_date);

-- One row per open invoice at the AR snapshot date.
-- Aging buckets are derived at query time from as_of - due_date.
create table ar_open_items (
  id             bigserial primary key,
  entity_id      int  not null references entities(id) on delete cascade,
  upload_id      int  not null references uploads(id)  on delete cascade,
  as_of          date not null,
  invoice_number text,
  invoice_date   date,
  due_date       date,
  customer_name  text not null,
  vertical_id    int  references verticals(id),
  salesperson    text,
  currency       text not null default 'INR',
  exchange_rate  numeric(18,6) not null default 1,
  invoice_amount numeric(18,2) not null default 0,   -- INR base
  balance_base   numeric(18,2) not null default 0,   -- INR base
  unused_credit  numeric(18,2) not null default 0
);
create index ar_asof_idx     on ar_open_items (entity_id, as_of);
create index ar_customer_idx on ar_open_items (entity_id, as_of, customer_name);

-- ---------- auth ----------

create table users (
  id            serial primary key,
  email         citext not null unique,
  name          text,
  password_hash text not null,
  role          text not null default 'viewer',      -- admin | viewer
  entity_id     int references entities(id) on delete cascade,
  last_login_at timestamptz,
  created_at    timestamptz not null default now()
);

create table sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    int not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index sessions_user_idx on sessions (user_id);

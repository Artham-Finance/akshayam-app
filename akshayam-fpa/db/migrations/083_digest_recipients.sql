-- ============================================================
-- Who receives the Monday and Friday evening update.
--
-- Not everyone with a login: a flag on the user. Each person flagged gets their own mail, drawn
-- from the companies, group or slices they have been granted and the reports their access allows.
-- Anyone not flagged gets nothing.
--
-- On trial with Bhuvana alone. To add someone later:
--   update users set receives_update = true where email = 'someone@example.com';
-- ============================================================

alter table users
  add column if not exists receives_update boolean not null default false;

update users
   set receives_update = true
 where lower(email::text) = 'bhuvana.r@akshayamcorporate.com';

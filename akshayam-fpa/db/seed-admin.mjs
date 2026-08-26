#!/usr/bin/env node
/**
 * Create the first administrator, from the environment.
 *
 *   SEED_ADMIN_EMAIL=you@example.com SEED_ADMIN_PASSWORD=... npm run seed:admin
 *
 * Create-only, and deliberately so: this runs on every deploy, and a script
 * that reset a password each time it ran would quietly undo any change the
 * admin had made to their own. If the login already exists it is left exactly
 * as it is and the script says so.
 *
 * The new admin is granted every company that exists at the time. That is the
 * right default for the person bootstrapping the system and no one else — from
 * then on, grants are made deliberately in Settings → People.
 */
import { createRequire } from "node:module";
import pg from "pg";

const require = createRequire(import.meta.url);
const bcrypt = require("bcryptjs");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("\n  DATABASE_URL is not set.\n");
  process.exit(1);
}

const email = (process.env.SEED_ADMIN_EMAIL ?? "").trim().toLowerCase();
const password = process.env.SEED_ADMIN_PASSWORD ?? "";
const name = (process.env.SEED_ADMIN_NAME ?? "Admin").trim();

if (!email || !password) {
  console.log("  Skipping admin seed: SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set.");
  process.exit(0);
}
if (password.length < 10) {
  console.error("\n  SEED_ADMIN_PASSWORD must be at least 10 characters.\n");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();

try {
  const { rows: existing } = await client.query("select id from users where email = $1", [
    email,
  ]);

  if (existing.length > 0) {
    console.log(`  Admin ${email} already exists - left untouched.`);
    process.exit(0);
  }

  const hash = await bcrypt.hash(password, 12);

  await client.query("begin");
  const { rows } = await client.query(
    `insert into users (email, name, password_hash, role, must_change_password)
     values ($1, $2, $3, 'admin', false)
     returning id`,
    [email, name || null, hash],
  );
  const id = rows[0].id;

  const { rowCount } = await client.query(
    `insert into user_entities (user_id, entity_id)
     select $1, id from entities
     on conflict do nothing`,
    [id],
  );
  await client.query("commit");

  console.log(`  + created admin ${email} with access to ${rowCount} companies.`);
} catch (err) {
  await client.query("rollback").catch(() => {});
  console.error(`\n  Could not seed the admin: ${err.message}\n`);
  process.exit(1);
} finally {
  await client.end();
}

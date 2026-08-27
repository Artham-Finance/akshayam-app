#!/usr/bin/env node
/**
 * Create the first administrator.
 *
 *   npm run seed:admin                        development: admin@admin.com / admin
 *   SEED_ADMIN_EMAIL=you@example.com SEED_ADMIN_PASSWORD=... npm run seed:admin
 *
 * A fresh clone should be usable without first hunting for environment
 * variables, so out of the box this creates admin@admin.com with the password
 * `admin`. Those defaults apply in development only, and are refused twice
 * over (see below), because this script also runs on every production deploy
 * and a deploy that quietly created admin/admin on a public host would be a
 * hole rather than a convenience.
 *
 * Create-only, and deliberately so: if the login already exists it is left
 * exactly as it is. A script that reset the password each time it ran would
 * quietly undo any change the admin had made to their own.
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

/**
 * Convenience credentials for a fresh checkout. An email rather than a bare
 * "admin" because the login field is type="email" and the browser refuses
 * anything else before the form is even submitted.
 */
const DEV_DEFAULTS = { email: "admin@admin.com", password: "admin", name: "Admin" };

const isProduction = process.env.NODE_ENV === "production";

/**
 * Two independent guards, because the cost of getting this wrong is an
 * administrator account with a guessable password on a public host.
 *
 *   1. NODE_ENV, which the server sets in its .env.local.
 *   2. the database host, which catches the case the first one misses —
 *      running the seed locally with DATABASE_URL pointed at the live box.
 *
 * Either one alone is enough to withhold the defaults.
 */
function targetsLocalDatabase() {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "";
  } catch {
    return false; // unparseable - assume it is not local and withhold
  }
}

const defaultsAllowed = !isProduction && targetsLocalDatabase();

const email = (process.env.SEED_ADMIN_EMAIL ?? (defaultsAllowed ? DEV_DEFAULTS.email : ""))
  .trim()
  .toLowerCase();
const password =
  process.env.SEED_ADMIN_PASSWORD ?? (defaultsAllowed ? DEV_DEFAULTS.password : "");
const name = (process.env.SEED_ADMIN_NAME ?? DEV_DEFAULTS.name).trim();

const usingDefaults =
  defaultsAllowed &&
  process.env.SEED_ADMIN_EMAIL === undefined &&
  process.env.SEED_ADMIN_PASSWORD === undefined;

if (!email || !password) {
  console.log("  Skipping admin seed: SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set.");
  if (isProduction) console.log("  (defaults are development-only)");
  process.exit(0);
}

// The length rule is what makes a password worth having, so it holds wherever
// a real one is being set. It is relaxed only for the throwaway dev default.
if (!usingDefaults && password.length < 10) {
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
  if (usingDefaults) {
    console.log(`    password: ${DEV_DEFAULTS.password}  (development default)`);
    console.log("    Set SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD for anything real.");
  }
} catch (err) {
  await client.query("rollback").catch(() => {});
  console.error(`\n  Could not seed the admin: ${err.message}\n`);
  process.exit(1);
} finally {
  await client.end();
}

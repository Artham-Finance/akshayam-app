#!/usr/bin/env node
/**
 * Log in the people named to a single RBJV vertical, plus the handful with
 * broader access, against the companies 022_vertical_slice_entities.sql
 * sliced out for exactly this.
 *
 *   SEED_REVIEWER_PASSWORD='...' npm run seed:reviewers
 *
 * Unlike seed-admin.mjs this has no development default and no fallback of
 * any kind - these are real people's logins, not a throwaway bootstrap
 * account, so there is nothing safe to bake into a committed file. Skips
 * itself (exit 0) whenever SEED_REVIEWER_PASSWORD is unset, so it is safe to
 * leave in place without ever running by accident.
 *
 * Create-only, the same rule seed-admin.mjs applies to the one admin login it
 * makes: a login that already exists is left exactly as it is, so re-running
 * this after someone has changed their own password can never put the old
 * one back.
 *
 * The roster and each person's grant are not secret - names, work emails and
 * which company or vertical they see are the ordinary content of this file.
 * Only the password comes from outside it.
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

const password = process.env.SEED_REVIEWER_PASSWORD ?? "";
if (!password) {
  console.log("  Skipping reviewer seed: SEED_REVIEWER_PASSWORD not set.");
  process.exit(0);
}
if (password.length < 10) {
  console.error("\n  SEED_REVIEWER_PASSWORD must be at least 10 characters.\n");
  process.exit(1);
}

/**
 * Nine viewers and two contributors hold a whole company each - both
 * companies, the group, and RAJA, the same "sees everything the system
 * currently offers" grant seed-admin.mjs gives the bootstrap admin. Six
 * viewers hold exactly one of the slice companies 022 created: Gayathri gets
 * CMRGA and nothing else of RBJV. Raja Krishnan's own vertical (AIF and
 * GIFT) already exists as the RAJA entity, so his grant is that, not a
 * seventh slice.
 */
const ROSTER = [
  { email: "bhuvana.r@akshayamcorporate.com", name: "Bhuvana Raman", role: "viewer", slugs: ["rbjv", "akshayam", "group", "raja"] },
  { email: "jayanth.v@akshayamcorporate.com", name: "Jayanth Viswanathan", role: "viewer", slugs: ["rbjv", "akshayam", "group", "raja"] },
  { email: "mohana.srinivasan@akshayamcorporate.com", name: "Mohana Srinivasan", role: "viewer", slugs: ["rbjv", "akshayam", "group", "raja"] },
  { email: "gayathri.g@akshayamcorporate.com", name: "Gayathri", role: "viewer", slugs: ["cmrga"] },
  { email: "rekha.g@akshayamcorporate.com", name: "Rekha", role: "viewer", slugs: ["cfc"] },
  { email: "vijay.legal@akshayamcorporate.com", name: "Vijay Vigneshwar", role: "viewer", slugs: ["dlr"] },
  { email: "dharshan.p@akshayamcorporate.com", name: "Dharshan", role: "viewer", slugs: ["rrg"] },
  { email: "vasudharini.k@akshayamcorporate.com", name: "Vasudharini", role: "viewer", slugs: ["ecm"] },
  { email: "ekta@akshayamcorporate.com", name: "Ekta", role: "viewer", slugs: ["gadd"] },
  { email: "raja.krishnan@akshayamcorporate.com", name: "Raja Krishnan", role: "viewer", slugs: ["raja"] },
  { email: "accounts@akshayamcorporate.com", name: "Annapoorani", role: "contributor", slugs: ["rbjv", "akshayam", "group", "raja"] },
  { email: "janhavi@un-maze.com", name: "Janhavi", role: "contributor", slugs: ["rbjv", "akshayam", "group", "raja"] },
];

const client = new pg.Client({ connectionString: url });
await client.connect();

try {
  const hash = await bcrypt.hash(password, 12);
  let created = 0;
  let skipped = 0;

  for (const person of ROSTER) {
    const email = person.email.trim().toLowerCase();

    const { rows: existing } = await client.query("select id from users where email = $1", [
      email,
    ]);
    if (existing.length > 0) {
      console.log(`  = ${email} already exists - left untouched.`);
      skipped++;
      continue;
    }

    await client.query("begin");
    try {
      const { rows } = await client.query(
        `insert into users (email, name, password_hash, role, must_change_password)
         values ($1, $2, $3, $4, false)
         returning id`,
        [email, person.name, hash, person.role],
      );
      const id = rows[0].id;

      const { rowCount, rows: missing } = await client.query(
        `select s.slug from unnest($1::text[]) as s(slug)
          where not exists (select 1 from entities e where e.slug = s.slug)`,
        [person.slugs],
      );
      if (missing.length > 0) {
        throw new Error(
          `unknown compan${missing.length === 1 ? "y" : "ies"}: ${missing
            .map((r) => r.slug)
            .join(", ")}`,
        );
      }

      await client.query(
        `insert into user_entities (user_id, entity_id)
         select $1, e.id from entities e where e.slug = any($2::text[])`,
        [id, person.slugs],
      );

      await client.query("commit");
      console.log(`  + created ${email} (${person.role}) - ${person.slugs.join(", ")}`);
      created++;
    } catch (err) {
      await client.query("rollback");
      throw err;
    }
  }

  console.log(`\n  ${created} created, ${skipped} already existed.`);
} catch (err) {
  console.error(`\n  Could not seed the reviewer roster: ${err.message}\n`);
  process.exit(1);
} finally {
  await client.end();
}

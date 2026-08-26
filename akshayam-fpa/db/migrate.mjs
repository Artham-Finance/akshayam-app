#!/usr/bin/env node
/**
 * Minimal migration runner.
 *   npm run db:migrate          apply pending migrations
 *   npm run db:migrate -- --reset   drop and recreate the schema first
 *
 * Each file in db/migrations is applied once, in filename order, inside a
 * transaction, and recorded in _migrations.
 */
import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "migrations");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    "\n  DATABASE_URL is not set.\n" +
      "  Copy .env.example to .env.local and fill in your PostgreSQL password.\n",
  );
  process.exit(1);
}

const reset = process.argv.includes("--reset");

/** Create the target database if the server is reachable but the database is not there yet. */
async function ensureDatabaseExists() {
  const target = new URL(url);
  const dbName = decodeURIComponent(target.pathname.replace(/^\//, ""));
  const admin = new URL(url);
  admin.pathname = "/postgres";

  const bootstrap = new pg.Client({ connectionString: admin.toString() });
  await bootstrap.connect();
  const { rowCount } = await bootstrap.query("select 1 from pg_database where datname = $1", [
    dbName,
  ]);
  if (rowCount === 0) {
    // Identifier cannot be parameterised; dbName comes from our own env file.
    await bootstrap.query(`create database "${dbName.replace(/"/g, '""')}"`);
    console.log(`  + created database ${dbName}`);
  }
  await bootstrap.end();
}

const client = new pg.Client({ connectionString: url });

try {
  await client.connect();
} catch (err) {
  if (err.code === "3D000") {
    // Database does not exist yet - create it, then retry once.
    try {
      await ensureDatabaseExists();
      await client.connect();
    } catch (inner) {
      console.error(`\n  Could not create the database: ${inner.message}\n`);
      process.exit(1);
    }
  } else if (err.code === "28P01") {
    console.error(
      "\n  PostgreSQL rejected the password in DATABASE_URL.\n" +
        "  Check the password in .env.local (percent-encode @ : / and ? if present).\n",
    );
    process.exit(1);
  } else {
    console.error(`\n  Could not connect to PostgreSQL: ${err.message}\n`);
    process.exit(1);
  }
}

if (reset) {
  console.log("  ! dropping and recreating schema public");
  await client.query("drop schema public cascade; create schema public;");
}

await client.query(`
  create table if not exists _migrations (
    name       text primary key,
    checksum   text not null,
    applied_at timestamptz not null default now()
  )
`);

const { rows: applied } = await client.query("select name, checksum from _migrations");
const appliedByName = new Map(applied.map((r) => [r.name, r.checksum]));

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

let ran = 0;
for (const file of files) {
  const sql = readFileSync(join(migrationsDir, file), "utf8");
  const checksum = createHash("sha256").update(sql).digest("hex").slice(0, 16);
  const prior = appliedByName.get(file);

  if (prior) {
    if (prior !== checksum) {
      console.warn(`  ~ ${file} already applied but its contents changed since.`);
      console.warn("    Use --reset to rebuild, or add a new migration instead.");
    }
    continue;
  }

  process.stdout.write(`  > ${file} ... `);
  try {
    await client.query("begin");
    await client.query(sql);
    await client.query("insert into _migrations (name, checksum) values ($1, $2)", [
      file,
      checksum,
    ]);
    await client.query("commit");
    console.log("ok");
    ran++;
  } catch (err) {
    await client.query("rollback");
    console.log("FAILED");
    console.error(`\n  ${err.message}\n`);
    await client.end();
    process.exit(1);
  }
}

console.log(ran === 0 ? "  Database already up to date." : `  Applied ${ran} migration(s).`);
await client.end();

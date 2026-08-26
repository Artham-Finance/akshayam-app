#!/usr/bin/env node
/**
 * One-command database setup.
 *
 *   npm run db:setup
 *
 * Prompts for the PostgreSQL superuser password (hidden), then:
 *   1. creates a dedicated application role with a freshly generated password
 *   2. creates the akshayam_fpa database owned by that role
 *   3. writes DATABASE_URL into .env.local
 *   4. applies the migrations
 *
 * The superuser password is used for this session only - it is never written
 * to disk, echoed, or stored anywhere. The application itself never runs as
 * superuser; it connects as the limited role created here.
 *
 * Non-interactive alternative (e.g. CI):  PGPASSWORD=... npm run db:setup
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(projectRoot, ".env.local");

const DB_NAME = "akshayam_fpa";
const APP_ROLE = "akshayam_app";
const HOST = process.env.PGHOST ?? "localhost";
const PORT = process.env.PGPORT ?? "5432";
const SUPERUSER = process.env.PGUSER ?? "postgres";

/* ---------- hidden password prompt ---------- */

function promptHidden(question) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      reject(
        new Error(
          "This script needs an interactive terminal to ask for the password.\n\n" +
            "  Use Windows PowerShell (not PowerShell ISE - it has no real console),\n" +
            "  then run:  node db/setup.mjs\n\n" +
            "  Non-interactive alternative:  $env:PGPASSWORD=\"...\"; node db/setup.mjs",
        ),
      );
      return;
    }

    process.stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    let value = "";
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n" || char === "\u0004") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener("data", onData);
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (char === "\u0003") {
          stdin.setRawMode(false);
          process.stdout.write("\n");
          process.exit(130);
        }
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else value += char;
      }
    };

    stdin.on("data", onData);
  });
}

/* ---------- helpers ---------- */

/** URL-safe by construction, so it never needs percent-encoding in a connection string. */
function generatePassword() {
  return randomBytes(24).toString("base64url");
}

function quoteIdent(name) {
  return `"${name.replace(/"/g, '""')}"`;
}

function quoteLiteral(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

async function connectAsSuperuser(password) {
  const client = new pg.Client({
    host: HOST,
    port: Number(PORT),
    user: SUPERUSER,
    password,
    database: "postgres",
  });
  await client.connect();
  return client;
}

/** Replace or append a KEY=value line, preserving everything else in the file. */
function upsertEnvLine(contents, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  if (pattern.test(contents)) return contents.replace(pattern, line);
  return contents.trimEnd() + `\n${line}\n`;
}

function run(command, args, env) {
  return new Promise((resolve) => {
    // No shell: process.execPath is an absolute path that contains spaces on
    // Windows ("C:\Program Files\nodejs\node.exe"), and a shell would split it.
    const child = spawn(command, args, {
      cwd: projectRoot,
      env: { ...process.env, ...env },
      stdio: "inherit",
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

/* ---------- main ---------- */

console.log("\n  Setting up the Akshayam reporting database.\n");

let superPassword = process.env.PGPASSWORD ?? null;
let client = null;

for (let attempt = 1; attempt <= 3 && !client; attempt++) {
  if (!superPassword) {
    try {
      superPassword = await promptHidden(
        `  Password for PostgreSQL user "${SUPERUSER}": `,
      );
    } catch (err) {
      console.error(`\n  ${err.message}\n`);
      process.exit(1);
    }
  }

  try {
    client = await connectAsSuperuser(superPassword);
  } catch (err) {
    if (err.code === "28P01") {
      const canRetry = process.stdin.isTTY && attempt < 3;
      console.error(
        canRetry
          ? "  That password was not accepted. Try again.\n"
          : `  The password for "${SUPERUSER}" was not accepted.\n`,
      );
      superPassword = null;
      if (!canRetry) process.exit(1);
    } else if (err.code === "ECONNREFUSED") {
      console.error(
        `\n  Nothing is listening on ${HOST}:${PORT}.\n` +
          "  Check that the postgresql-x64-18 service is running.\n",
      );
      process.exit(1);
    } else {
      console.error(`\n  Could not connect: ${err.message}\n`);
      process.exit(1);
    }
  }
}

const appPassword = generatePassword();

try {
  // 1. Application role. Reset the password if the role already exists, so the
  //    script stays safe to re-run.
  const roleExists = await client.query("select 1 from pg_roles where rolname = $1", [APP_ROLE]);
  if (roleExists.rowCount === 0) {
    await client.query(
      `create role ${quoteIdent(APP_ROLE)} login password ${quoteLiteral(appPassword)}`,
    );
    console.log(`  + created role ${APP_ROLE}`);
  } else {
    await client.query(
      `alter role ${quoteIdent(APP_ROLE)} login password ${quoteLiteral(appPassword)}`,
    );
    console.log(`  ~ reset password for existing role ${APP_ROLE}`);
  }

  // 2. Database, owned by the application role so it can create its own tables
  //    and the trusted extensions the schema needs.
  const dbExists = await client.query("select 1 from pg_database where datname = $1", [DB_NAME]);
  if (dbExists.rowCount === 0) {
    await client.query(
      `create database ${quoteIdent(DB_NAME)} owner ${quoteIdent(APP_ROLE)}`,
    );
    console.log(`  + created database ${DB_NAME}`);
  } else {
    await client.query(
      `alter database ${quoteIdent(DB_NAME)} owner to ${quoteIdent(APP_ROLE)}`,
    );
    console.log(`  ~ database ${DB_NAME} already existed`);
  }
} catch (err) {
  console.error(`\n  Setup failed: ${err.message}\n`);
  await client.end();
  process.exit(1);
} finally {
  if (client) await client.end();
}

// 3. Write the connection string. Keep any SESSION_SECRET already generated.
const connectionString = `postgresql://${APP_ROLE}:${appPassword}@${HOST}:${PORT}/${DB_NAME}`;

let env = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
if (!env.includes("SESSION_SECRET=")) {
  env = upsertEnvLine(env, "SESSION_SECRET", randomBytes(32).toString("hex"));
}
if (!env.includes("UPLOAD_DIR=")) {
  env = upsertEnvLine(env, "UPLOAD_DIR", "./storage/uploads");
}
env = upsertEnvLine(env, "DATABASE_URL", connectionString);

// Strip the placeholder comment now that a real value is in place.
env = env.replace(/^# STEP 1:.*$\n?/m, "");

writeFileSync(envPath, env.trimStart(), { mode: 0o600 });
console.log("  + wrote DATABASE_URL to .env.local");

// 4. Migrate.
console.log("\n  Applying migrations...\n");
const code = await run(process.execPath, [join("db", "migrate.mjs")], {
  DATABASE_URL: connectionString,
});

if (code !== 0) {
  console.error("\n  Migrations failed. The database and role were still created.\n");
  process.exit(code);
}

console.log(
  "\n  Done. The app connects as the limited role " +
    `"${APP_ROLE}", not as a superuser.\n` +
    "  Restart the dev server so it picks up .env.local, then open http://localhost:3000\n",
);

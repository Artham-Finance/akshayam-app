import { Pool, types, type PoolClient, type QueryResultRow } from "pg";

// pg returns numeric/int8 as strings to protect precision. Our figures are
// rupees with 2 decimals and well inside IEEE-754 safe range, so parse them to
// numbers here rather than sprinkling Number() across every report.
types.setTypeParser(1700, (v) => (v === null ? null : Number(v))); // numeric
types.setTypeParser(20, (v) => (v === null ? null : Number(v))); // int8
// Keep DATE as the plain YYYY-MM-DD string: no timezone shifting on the way out.
types.setTypeParser(1082, (v) => v);

declare global {
  // Reuse the pool across hot reloads in dev, otherwise every edit leaks connections.
  var __fpaPool: Pool | undefined;
}

function createPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and add your PostgreSQL password.",
    );
  }
  return new Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000 });
}

export const pool: Pool = globalThis.__fpaPool ?? createPool();
if (process.env.NODE_ENV !== "production") globalThis.__fpaPool = pool;

/** Run a query and get the rows. */
export async function query<T extends QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(text, params);
  return result.rows;
}

/** Run a query expected to return at most one row. */
export async function queryOne<T extends QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/** Run a set of statements in a single transaction, rolling back on any throw. */
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

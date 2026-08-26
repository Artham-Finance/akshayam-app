import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { query, queryOne } from "@/lib/db";

/**
 * Session handling.
 *
 * The cookie carries 32 random bytes and nothing else — no user id, no role,
 * no expiry. Everything the application trusts is read from the database on
 * each request, so a role revoked at 10:00 is revoked at 10:00 rather than
 * whenever the holder's cookie happens to expire.
 *
 * The database stores only sha256(token). A read of the sessions table
 * therefore yields nothing that can be presented as a login. There is no
 * signing secret to manage because there is nothing in the cookie worth
 * forging: a token either matches a stored hash or it does not.
 */

export const SESSION_COOKIE = "fpa_session";

/** Fourteen days. Long enough not to nag, short enough that a stale laptop lapses. */
const SESSION_DAYS = 14;

/** Refresh last_seen_at at most this often, to keep reads from writing constantly. */
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

export interface SessionRow {
  session_id: string;
  user_id: number;
  expires_at: Date;
  last_seen_at: Date;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Cookie flags.
 *
 * `secure` is off when NODE_ENV is not production so that `next dev` over
 * plain http still logs in; production is always https here.
 */
function cookieOptions(expires: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  };
}

/** Issue a session for a user and set the cookie. Returns nothing useful on purpose. */
export async function createSession(
  userId: number,
  meta: { userAgent?: string | null; ip?: string | null } = {},
): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  await query(
    `insert into sessions (user_id, token_hash, expires_at, user_agent, ip)
     values ($1, $2, $3, $4, $5)`,
    [userId, hashToken(token), expiresAt, meta.userAgent ?? null, meta.ip ?? null],
  );

  const store = await cookies();
  store.set(SESSION_COOKIE, token, cookieOptions(expiresAt));
}

/**
 * The session behind the current request, or null.
 *
 * Expired rows are treated as absent and deleted on sight, so the table stays
 * tidy without a sweeper job.
 */
export async function readSession(): Promise<SessionRow | null> {
  let token: string | undefined;
  try {
    const store = await cookies();
    token = store.get(SESSION_COOKIE)?.value;
  } catch {
    // Outside a request scope (scripts, build-time prerender).
    return null;
  }
  if (!token) return null;

  const row = await queryOne<SessionRow>(
    `select id as session_id, user_id, expires_at, last_seen_at
       from sessions where token_hash = $1`,
    [hashToken(token)],
  );
  if (!row) return null;

  if (row.expires_at.getTime() <= Date.now()) {
    await query("delete from sessions where id = $1", [row.session_id]);
    return null;
  }

  if (Date.now() - row.last_seen_at.getTime() > TOUCH_INTERVAL_MS) {
    await query("update sessions set last_seen_at = now() where id = $1", [row.session_id]);
  }

  return row;
}

/** Drop the current session both server-side and in the browser. */
export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await query("delete from sessions where token_hash = $1", [hashToken(token)]);
  }
  store.delete(SESSION_COOKIE);
}

/** Log a user out everywhere — used when a password changes or access is revoked. */
export async function destroyAllSessionsFor(userId: number): Promise<void> {
  await query("delete from sessions where user_id = $1", [userId]);
}

/**
 * Constant-time string comparison, for the few places comparing secrets by
 * value. Length differences leak regardless, so equal-length is required.
 */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

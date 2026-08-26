"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { queryOne, query } from "@/lib/db";
import { audit, getCurrentUser } from "@/lib/auth/dal";
import { DUMMY_HASH, verifyPassword } from "@/lib/auth/password";
import { createSession, destroySession } from "@/lib/auth/session";

export interface LoginState {
  error: string | null;
}

/**
 * One message for every way a login can fail.
 *
 * "No such user" and "wrong password" told apart is a way to enumerate who
 * works here, and on a finance system the staff list is itself worth
 * something. A deactivated account is folded in for the same reason.
 */
const REJECTED = "That email and password do not match an active account.";

interface LoginRow {
  id: number;
  password_hash: string;
  is_active: boolean;
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/");

  if (!email || !password) return { error: "Enter your email and password." };

  const row = await queryOne<LoginRow>(
    "select id, password_hash, is_active from users where email = $1",
    [email],
  );

  // Always spend the cost of one bcrypt comparison, so an unknown address does
  // not answer measurably faster than a known one.
  const ok = await verifyPassword(password, row?.password_hash ?? DUMMY_HASH);

  if (!row || !row.is_active || !ok) {
    await audit(null, "login.failed", { email });
    return { error: REJECTED };
  }

  const head = await headers();
  await createSession(row.id, {
    userAgent: head.get("user-agent"),
    // Behind nginx the socket address is always localhost; the real client is
    // in the header nginx sets.
    ip: head.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  });

  await query("update users set last_login_at = now() where id = $1", [row.id]);
  await audit({ id: row.id, email }, "login.ok", {});

  // Only ever bounce back to a path on this site: an open redirect here would
  // turn the login page into a credible phishing hop.
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

export async function logout(): Promise<void> {
  const user = await getCurrentUser();
  if (user) await audit(user, "logout", {});
  await destroySession();
  redirect("/login");
}

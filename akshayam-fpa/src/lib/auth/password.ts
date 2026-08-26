import "server-only";

import bcrypt from "bcryptjs";

/**
 * Password hashing.
 *
 * bcrypt at cost 12. The box this runs on has one vCPU, so the cost is a real
 * trade: 12 lands around a quarter of a second here, which is slow enough to
 * make offline guessing expensive and fast enough that a login does not feel
 * broken. Raise it when the hardware improves — existing hashes carry their own
 * cost and keep verifying, so a change applies to new passwords only.
 */
const COST = 12;

/** Rules kept deliberately short: length is what actually helps. */
export const MIN_PASSWORD_LENGTH = 10;

export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > 200) return "That is too long to be a password.";
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, COST);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    // A malformed hash in the row should read as "wrong password", not a 500.
    return false;
  }
}

/**
 * A hash of a password nobody holds, for the no-such-user branch of login.
 *
 * Answering an unknown email instantly while a known one takes a quarter of a
 * second tells an attacker which addresses are real. Comparing against this
 * makes both paths cost the same.
 */
export const DUMMY_HASH = "$2b$12$hotCN9J50MTJuOY1fY8I.OE9.bJfMrFkoT6JYmaGsxsRfQSeQB2cC";

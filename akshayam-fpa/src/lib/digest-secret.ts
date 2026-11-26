import { createHash } from "node:crypto";

/**
 * What the app's own timer shows to /api/digest/run, so the route knows the call is the
 * scheduler's and not a stranger's. Derived from the session secret rather than kept as a
 * second secret to set and rotate; the secret itself never leaves the server.
 */
export function digestSecret(): string {
  return createHash("sha256")
    .update(`digest:${process.env.SESSION_SECRET ?? ""}`)
    .digest("hex");
}

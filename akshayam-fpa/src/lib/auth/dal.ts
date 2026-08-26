import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { query, queryOne } from "@/lib/db";
import { readSession } from "@/lib/auth/session";
import {
  isRole,
  permissionsFor,
  roleCan,
  type Permission,
  type Role,
} from "@/lib/auth/permissions";

/**
 * The Data Access Layer.
 *
 * Every authorisation decision in the application is made here, as close to
 * the database as it can be, because that is the only place that cannot be
 * bypassed. `proxy.ts` also turns signed-out visitors away, but that is a
 * courtesy to save a render — it is not a security boundary and nothing here
 * relies on it having run.
 *
 * `cache` scopes memoisation to a single render pass, so a page that asks for
 * the current user in the layout, the nav and three components makes one query.
 *
 * Note on what this deliberately does not use: Next's `forbidden()` and
 * `unauthorized()` would give tidy 403/401 pages, but both are experimental and
 * need `experimental.authInterrupts`. An access-control path is the last place
 * to take a dependency on an API that can change under a patch upgrade, so
 * denials redirect to a real page instead.
 */

export interface CurrentUser {
  id: number;
  email: string;
  name: string | null;
  role: Role;
  mustChangePassword: boolean;
  /** Entity ids this person may see. Empty means they have been granted none. */
  entityIds: number[];
  permissions: Permission[];
}

interface UserRow {
  id: number;
  email: string;
  name: string | null;
  role: string;
  must_change_password: boolean;
  is_active: boolean;
  entity_ids: number[] | null;
}

/**
 * The signed-in user, or null.
 *
 * Deactivated accounts read as signed out even while holding a live cookie, so
 * switching someone off takes effect on their next request rather than at the
 * end of their fortnight.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await readSession();
  if (!session) return null;

  const row = await queryOne<UserRow>(
    `select u.id, u.email, u.name, u.role, u.must_change_password, u.is_active,
            array_remove(array_agg(ue.entity_id), null) as entity_ids
       from users u
       left join user_entities ue on ue.user_id = u.id
      where u.id = $1
      group by u.id`,
    [session.user_id],
  );

  if (!row || !row.is_active) return null;

  // An unrecognised role in the column is a bug, not a licence: fall back to
  // the least privilege rather than crashing or, worse, admitting the user.
  const role: Role = isRole(row.role) ? row.role : "viewer";

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role,
    mustChangePassword: row.must_change_password,
    entityIds: row.entity_ids ?? [],
    permissions: permissionsFor(role),
  };
});

/**
 * The signed-in user, or a redirect to the login page.
 *
 * Someone who has simply been away for a fortnight should meet a login form,
 * not an error.
 */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Assert a capability for a page render, sending the user somewhere useful if absent. */
export async function requirePermission(permission: Permission): Promise<CurrentUser> {
  const user = await requireUser();
  if (!roleCan(user.role, permission)) {
    redirect(`/no-access?need=${encodeURIComponent(permission)}`);
  }
  return user;
}

/** As `requirePermission`, but also insists on at least one granted company. */
export async function requirePermissionAndEntity(
  permission: Permission,
): Promise<CurrentUser> {
  const user = await requirePermission(permission);
  if (user.entityIds.length === 0) redirect("/no-companies");
  return user;
}

/**
 * A signed-in user who has been granted at least one company.
 *
 * Called at the top of every page, deliberately *before* the try/catch each
 * report wraps around `getEntity`. `redirect` works by throwing, so a call
 * made inside that try/catch would be swallowed and the page would render a
 * "set up the database" notice at someone whose only problem is that nobody
 * has granted them a company yet.
 */
export async function requireEntityAccess(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.entityIds.length === 0) redirect("/no-companies");
  return user;
}

/** Non-throwing check, for deciding whether to render a button. */
export async function can(permission: Permission): Promise<boolean> {
  const user = await getCurrentUser();
  return user ? roleCan(user.role, permission) : false;
}

/**
 * Assert a capability inside a route handler.
 *
 * Returns either the user or a Response to hand straight back. Route handlers
 * have no render to interrupt, and returning the response keeps the failure
 * visible at the call site rather than throwing something the handler might
 * swallow in its own try/catch.
 *
 * Every role holds `reports.view`, so that is also the way to say
 * "any signed-in user".
 */
export async function apiGuard(
  permission: Permission,
): Promise<{ user: CurrentUser; denied: null } | { user: null; denied: Response }> {
  const user = await getCurrentUser();
  if (!user) {
    return {
      user: null,
      denied: Response.json({ error: "Sign in to continue." }, { status: 401 }),
    };
  }
  if (!roleCan(user.role, permission)) {
    return {
      user: null,
      denied: Response.json({ error: "Your role does not allow this." }, { status: 403 }),
    };
  }
  return { user, denied: null };
}

/**
 * Whether a user may see a given entity.
 *
 * An admin is not automatically granted every company. Being able to
 * administer people is a different thing from being entitled to read a
 * partner's book, and conflating the two is how "admin" quietly becomes the
 * role everybody needs. An admin can of course grant themselves access — the
 * point is that doing so is a recorded act rather than an implicit one.
 */
export function userCanSeeEntity(user: CurrentUser, entityId: number): boolean {
  return user.entityIds.includes(entityId);
}

/** Record an action against a name, for the things that alter reported figures. */
export async function audit(
  user: Pick<CurrentUser, "id" | "email"> | null,
  action: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  try {
    await query(
      `insert into auth_audit (user_id, actor, action, detail) values ($1, $2, $3, $4)`,
      [user?.id ?? null, user?.email ?? "anonymous", action, JSON.stringify(detail)],
    );
  } catch {
    // An audit failure must not take the action down with it. The action is the
    // point; the log is only evidence about it.
  }
}

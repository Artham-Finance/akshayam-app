/**
 * The whole of the authorisation model, in one table.
 *
 * Code asks "may this person do X", never "is this person an admin". The
 * difference matters the first time a role is added or a capability moves
 * between roles: with named permissions that is an edit to the grid below,
 * and with role checks it is a hunt through every route handler.
 *
 * Roles are coarse on purpose. A finer-grained scheme (per-permission
 * assignment per user) is a bigger thing to administer than this client needs,
 * and the grid can be widened without changing a single call site.
 */

export const ROLES = ["admin", "contributor", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "reports.view",
  "reports.export",
  "data.upload",
  "data.delete",
  "accounts.map",
  "verticals.manage",
  "expenses.record",
  "users.manage",
  "entities.manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const VIEWER: Permission[] = ["reports.view", "reports.export"];

const CONTRIBUTOR: Permission[] = [
  ...VIEWER,
  "data.upload",
  "accounts.map",
  "verticals.manage",
  "expenses.record",
];

// Removing an upload takes its rows with it, so it sits with the admin. A
// contributor loading the wrong file can load the right one over it; undoing
// someone else's load is a different kind of act.
const ADMIN: Permission[] = [...CONTRIBUTOR, "users.manage", "entities.manage", "data.delete"];

const GRID: Record<Role, ReadonlySet<Permission>> = {
  admin: new Set(ADMIN),
  contributor: new Set(CONTRIBUTOR),
  viewer: new Set(VIEWER),
};

/** Display names for the roles, for pickers and badges. */
export const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  contributor: "Contributor",
  viewer: "Viewer",
};

export const ROLE_DESCRIPTION: Record<Role, string> = {
  admin: "Everything a contributor can do, plus managing people, their access, and removing an upload.",
  contributor: "Upload data, map accounts, tidy verticals and record expenses.",
  viewer: "Read the statements and download them. Changes nothing.",
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** Does this role carry this permission? The only authorisation question. */
export function roleCan(role: Role, permission: Permission): boolean {
  return GRID[role].has(permission);
}

/** Every permission a role carries — for sending to the client as a DTO. */
export function permissionsFor(role: Role): Permission[] {
  return PERMISSIONS.filter((p) => roleCan(role, p));
}

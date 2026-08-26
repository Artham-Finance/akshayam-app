"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import clsx from "clsx";
import { ROLES, ROLE_DESCRIPTION, ROLE_LABEL, type Role } from "@/lib/auth/permissions";

export interface AdminUser {
  id: number;
  email: string;
  name: string | null;
  role: Role;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  entityIds: number[];
}

interface EntityOption {
  id: number;
  name: string;
}

const INPUT =
  "w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-[12px] text-ink outline-none focus:border-navy";

function formatLastSeen(iso: string | null): string {
  if (!iso) return "never";
  const date = new Date(iso);
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * People administration.
 *
 * One row per person, expanding into the two things that actually change:
 * their role and which companies they may see. Everything posts to
 * /api/users, which re-checks the caller's permission - this component only
 * decides what is worth showing.
 */
export function UsersAdmin({
  users,
  entities,
  currentUserId,
}: {
  users: AdminUser[];
  entities: EntityOption[];
  currentUserId: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  const working = busy || pending;

  async function post(body: unknown, success: string) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const response = await fetch("/api/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? "That did not work.");
        return false;
      }
      setNote(success);
      setEditing(null);
      setAdding(false);
      startTransition(() => router.refresh());
      return true;
    } catch {
      setError("Could not reach the server.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700"
        >
          {error}
        </p>
      )}
      {note && (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-800">
          {note}
        </p>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          disabled={working}
          onClick={() => {
            setAdding((v) => !v);
            setEditing(null);
          }}
          className="rounded-md bg-navy px-3 py-1.5 text-[12px] font-semibold text-ink-invert hover:bg-navy-deep disabled:opacity-60"
        >
          {adding ? "Cancel" : "Add someone"}
        </button>
      </div>

      {adding && (
        <NewUserForm
          entities={entities}
          busy={working}
          onSubmit={(payload) =>
            post({ action: "create", ...payload }, `${payload.email} can now sign in.`)
          }
        />
      )}

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[720px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-line bg-surface-sunk text-left text-[11px] uppercase tracking-wider text-ink-faint">
              <th className="px-3 py-2 font-medium">Person</th>
              <th className="px-3 py-2 font-medium">Role</th>
              <th className="px-3 py-2 font-medium">Companies</th>
              <th className="px-3 py-2 font-medium">Last signed in</th>
              <th className="px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const isSelf = user.id === currentUserId;
              const open = editing === user.id;
              return (
                <tr
                  key={user.id}
                  className={clsx(
                    "border-b border-line align-top last:border-0",
                    !user.isActive && "opacity-55",
                  )}
                >
                  <td className="px-3 py-2.5">
                    <p className="font-medium text-ink">
                      {user.name || user.email}
                      {isSelf && (
                        <span className="ml-1.5 text-[11px] font-normal text-ink-faint">
                          (you)
                        </span>
                      )}
                    </p>
                    {user.name && (
                      <p className="text-[11px] text-ink-muted">{user.email}</p>
                    )}
                    {!user.isActive && (
                      <p className="mt-1 text-[11px] font-medium text-ink-faint">
                        Deactivated
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="inline-block rounded-sm bg-navy-tint px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-navy">
                      {ROLE_LABEL[user.role]}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-[12px] text-ink-muted">
                    {user.entityIds.length === 0 ? (
                      <span className="text-red-600">none granted</span>
                    ) : (
                      entities
                        .filter((e) => user.entityIds.includes(e.id))
                        .map((e) => e.name)
                        .join(", ")
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-[12px] text-ink-muted">
                    {formatLastSeen(user.lastLoginAt)}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <button
                      type="button"
                      disabled={working}
                      onClick={() => {
                        setEditing(open ? null : user.id);
                        setAdding(false);
                      }}
                      className="rounded-md px-2 py-1 text-[12px] font-medium text-navy hover:bg-navy-tint disabled:opacity-60"
                    >
                      {open ? "Close" : "Edit"}
                    </button>

                    {open && (
                      <EditPanel
                        user={user}
                        entities={entities}
                        isSelf={isSelf}
                        busy={working}
                        onSave={(payload) =>
                          post(
                            { action: "update", id: user.id, ...payload },
                            payload.password
                              ? `Saved ${user.email}, with a new password. They have been signed out everywhere.`
                              : `Saved ${user.name || user.email}.`,
                          )
                        }
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-line bg-surface-sunk p-4">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          What the roles mean
        </p>
        <dl className="space-y-1.5">
          {ROLES.map((role) => (
            <div key={role} className="flex gap-2 text-[12px]">
              <dt className="w-24 shrink-0 font-medium text-ink">{ROLE_LABEL[role]}</dt>
              <dd className="text-ink-muted">{ROLE_DESCRIPTION[role]}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function EntityChecklist({
  entities,
  selected,
  onChange,
  disabled,
}: {
  entities: EntityOption[];
  selected: number[];
  onChange: (ids: number[]) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5">
      {entities.map((entity) => (
        <label key={entity.id} className="flex items-center gap-1.5 text-[12px] text-ink">
          <input
            type="checkbox"
            disabled={disabled}
            checked={selected.includes(entity.id)}
            onChange={(e) =>
              onChange(
                e.target.checked
                  ? [...selected, entity.id]
                  : selected.filter((id) => id !== entity.id),
              )
            }
          />
          {entity.name}
        </label>
      ))}
    </div>
  );
}

function NewUserForm({
  entities,
  busy,
  onSubmit,
}: {
  entities: EntityOption[];
  busy: boolean;
  onSubmit: (payload: {
    email: string;
    name: string;
    role: Role;
    password: string;
    entityIds: number[];
  }) => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [password, setPassword] = useState("");
  const [entityIds, setEntityIds] = useState<number[]>([]);

  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-[11px] font-medium text-ink-muted">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={INPUT}
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-ink-muted">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={INPUT}
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-ink-muted">Role</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className={INPUT}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-ink-muted">
            First password
          </label>
          <input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="at least 10 characters"
            className={INPUT}
          />
        </div>
      </div>

      <div className="mt-3">
        <label className="mb-1.5 block text-[11px] font-medium text-ink-muted">
          Companies they may see
        </label>
        <EntityChecklist
          entities={entities}
          selected={entityIds}
          onChange={setEntityIds}
          disabled={busy}
        />
      </div>

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          disabled={busy}
          onClick={() => onSubmit({ email, name, role, password, entityIds })}
          className="rounded-md bg-navy px-3 py-1.5 text-[12px] font-semibold text-ink-invert hover:bg-navy-deep disabled:opacity-60"
        >
          Create account
        </button>
      </div>
    </div>
  );
}

function EditPanel({
  user,
  entities,
  isSelf,
  busy,
  onSave,
}: {
  user: AdminUser;
  entities: EntityOption[];
  isSelf: boolean;
  busy: boolean;
  onSave: (payload: {
    role: Role;
    isActive: boolean;
    entityIds: number[];
    password?: string;
  }) => void;
}) {
  const [role, setRole] = useState<Role>(user.role);
  const [isActive, setIsActive] = useState(user.isActive);
  const [entityIds, setEntityIds] = useState<number[]>(user.entityIds);
  const [password, setPassword] = useState("");

  return (
    <div className="mt-2 space-y-3 rounded-md border border-line bg-surface-sunk p-3 text-left">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-[11px] font-medium text-ink-muted">Role</label>
          <select
            value={role}
            disabled={busy || (isSelf && user.role === "admin")}
            onChange={(e) => setRole(e.target.value as Role)}
            className={INPUT}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
          {isSelf && user.role === "admin" && (
            <p className="mt-1 text-[10px] text-ink-faint">
              You cannot remove your own admin role.
            </p>
          )}
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-ink-muted">Status</label>
          <label className="flex items-center gap-1.5 py-1.5 text-[12px] text-ink">
            <input
              type="checkbox"
              checked={isActive}
              disabled={busy || isSelf}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            Can sign in
          </label>
          {isSelf && (
            <p className="text-[10px] text-ink-faint">
              You cannot deactivate yourself.
            </p>
          )}
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-[11px] font-medium text-ink-muted">
          Companies they may see
        </label>
        <EntityChecklist
          entities={entities}
          selected={entityIds}
          onChange={setEntityIds}
          disabled={busy}
        />
      </div>

      <div>
        <label className="mb-1 block text-[11px] font-medium text-ink-muted">
          New password <span className="text-ink-faint">(leave blank to keep the current one)</span>
        </label>
        <input
          type="text"
          value={password}
          disabled={busy}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="at least 10 characters"
          className={INPUT}
        />
      </div>

      <p className="text-[10px] leading-relaxed text-ink-faint">
        Saving a new password, a new role or a change of companies signs this
        person out everywhere. They will need to sign in again.
      </p>

      <div className="flex justify-end">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            onSave({
              role,
              isActive,
              entityIds,
              ...(password ? { password } : {}),
            });
            setPassword("");
          }}
          className="rounded-md bg-navy px-3 py-1.5 text-[12px] font-semibold text-ink-invert hover:bg-navy-deep disabled:opacity-60"
        >
          Save changes
        </button>
      </div>
    </div>
  );
}

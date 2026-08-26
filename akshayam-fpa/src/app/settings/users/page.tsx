import { UsersAdmin, type AdminUser } from "@/components/UsersAdmin";
import { PageHeader } from "@/components/ui";
import { query } from "@/lib/db";
import { requirePermission } from "@/lib/auth/dal";
import { listAllEntities } from "@/lib/entity";
import { isRole, type Role } from "@/lib/auth/permissions";

export const dynamic = "force-dynamic";

interface Row {
  id: number;
  email: string;
  name: string | null;
  role: string;
  is_active: boolean;
  must_change_password: boolean;
  last_login_at: Date | null;
  entity_ids: number[] | null;
}

export default async function UsersPage() {
  const actor = await requirePermission("users.manage");

  // Every company, not just the admin's own: you cannot grant access to a
  // company the picker refuses to list.
  const [rows, entities] = await Promise.all([
    query<Row>(
      `select u.id, u.email, u.name, u.role, u.is_active, u.must_change_password,
              u.last_login_at,
              array_remove(array_agg(ue.entity_id), null) as entity_ids
         from users u
         left join user_entities ue on ue.user_id = u.id
        group by u.id
        order by u.is_active desc, lower(coalesce(u.name, u.email))`,
    ),
    listAllEntities(),
  ]);

  const users: AdminUser[] = rows.map((r) => ({
    id: r.id,
    email: r.email,
    name: r.name,
    role: (isRole(r.role) ? r.role : "viewer") as Role,
    isActive: r.is_active,
    mustChangePassword: r.must_change_password,
    lastLoginAt: r.last_login_at ? r.last_login_at.toISOString() : null,
    entityIds: r.entity_ids ?? [],
  }));

  return (
    <div>
      <PageHeader
        title="People"
        subtitle="Who can sign in, what they may do, and whose books they may see."
      />
      <UsersAdmin
        users={users}
        entities={entities.map((e) => ({ id: e.id, name: e.name }))}
        currentUserId={actor.id}
      />
    </div>
  );
}

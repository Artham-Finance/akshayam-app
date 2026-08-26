import { NextResponse } from "next/server";
import { z } from "zod";
import { query, queryOne, transaction } from "@/lib/db";
import { apiGuard, audit } from "@/lib/auth/dal";
import { ROLES } from "@/lib/auth/permissions";
import { hashPassword, passwordProblem } from "@/lib/auth/password";
import { destroyAllSessionsFor } from "@/lib/auth/session";

export const runtime = "nodejs";

/**
 * People and their access.
 *
 * Everything here needs `users.manage`, which only an admin holds. Two rules
 * run through the whole file and exist to stop an administrator locking the
 * company out of its own books:
 *
 *   * you cannot take away your own admin role, and
 *   * you cannot deactivate yourself.
 *
 * Both are about the last admin standing. Either mistake is one click, and
 * recovering from it means someone with a database password.
 */

const EntityIds = z.array(z.number().int().positive()).max(50);

const Create = z.object({
  action: z.literal("create"),
  email: z.string().email().max(200),
  name: z.string().trim().max(120).optional(),
  role: z.enum(ROLES),
  password: z.string(),
  entityIds: EntityIds,
});

const Update = z.object({
  action: z.literal("update"),
  id: z.number().int().positive(),
  name: z.string().trim().max(120).optional(),
  role: z.enum(ROLES).optional(),
  isActive: z.boolean().optional(),
  entityIds: EntityIds.optional(),
  /** Optional. Saving a new password alongside the other changes is the same
   *  act to whoever is doing it, so it is the same request. */
  password: z.string().optional(),
});

const ResetPassword = z.object({
  action: z.literal("resetPassword"),
  id: z.number().int().positive(),
  password: z.string(),
});

const BodySchema = z.discriminatedUnion("action", [Create, Update, ResetPassword]);

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const { user: actor, denied } = await apiGuard("users.manage");
  if (denied) return denied;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return bad("Expected a JSON body.");
  }

  const parsed = BodySchema.safeParse(payload);
  if (!parsed.success) {
    return bad(parsed.error.issues[0]?.message ?? "That request was not valid.");
  }
  const body = parsed.data;

  // ---------- create ----------

  if (body.action === "create") {
    const problem = passwordProblem(body.password);
    if (problem) return bad(problem);

    const email = body.email.trim().toLowerCase();
    const existing = await queryOne<{ id: number }>(
      "select id from users where email = $1",
      [email],
    );
    if (existing) return bad("Someone already has that email address.", 409);

    const hash = await hashPassword(body.password);

    const created = await transaction(async (client) => {
      // must_change_password stays false: there is no change-password screen
      // yet, so setting it would promise a prompt that never comes.
      const { rows } = await client.query<{ id: number }>(
        `insert into users (email, name, password_hash, role, must_change_password)
         values ($1, $2, $3, $4, false)
         returning id`,
        [email, body.name?.trim() || null, hash, body.role],
      );
      const id = rows[0].id;
      if (body.entityIds.length > 0) {
        await client.query(
          `insert into user_entities (user_id, entity_id)
           select $1, unnest($2::int[])`,
          [id, body.entityIds],
        );
      }
      return id;
    });

    await audit(actor, "user.create", { id: created, email, role: body.role });
    return NextResponse.json({ ok: true, id: created });
  }

  // ---------- update ----------

  if (body.action === "update") {
    const target = await queryOne<{ id: number; email: string; role: string }>(
      "select id, email, role from users where id = $1",
      [body.id],
    );
    if (!target) return bad("No such person.", 404);

    const self = target.id === actor.id;
    if (self && body.role && body.role !== "admin") {
      return bad("You cannot remove your own admin role. Ask another admin to do it.");
    }
    if (self && body.isActive === false) {
      return bad("You cannot deactivate your own account.");
    }

    // Validate before opening the transaction, so a bad password is a 400 and
    // not a half-applied change.
    let newHash: string | null = null;
    if (body.password !== undefined && body.password !== "") {
      const pwProblem = passwordProblem(body.password);
      if (pwProblem) return bad(pwProblem);
      newHash = await hashPassword(body.password);
    }

    await transaction(async (client) => {
      if (newHash) {
        await client.query(
          "update users set password_hash = $2, updated_at = now() where id = $1",
          [body.id, newHash],
        );
      }
      if (body.name !== undefined || body.role !== undefined || body.isActive !== undefined) {
        await client.query(
          `update users
              set name       = coalesce($2, name),
                  role       = coalesce($3, role),
                  is_active  = coalesce($4, is_active),
                  updated_at = now()
            where id = $1`,
          [
            body.id,
            body.name?.trim() || null,
            body.role ?? null,
            body.isActive ?? null,
          ],
        );
      }
      if (body.entityIds !== undefined) {
        await client.query("delete from user_entities where user_id = $1", [body.id]);
        if (body.entityIds.length > 0) {
          await client.query(
            `insert into user_entities (user_id, entity_id)
             select $1, unnest($2::int[])`,
            [body.id, body.entityIds],
          );
        }
      }
    });

    // A revoked role or a withdrawn company should bite now, not in a
    // fortnight. Signing the user out is the bluntest way to guarantee it and
    // costs them one login.
    if (
      newHash ||
      body.role !== undefined ||
      body.isActive === false ||
      body.entityIds !== undefined
    ) {
      await destroyAllSessionsFor(body.id);
    }

    await audit(actor, "user.update", {
      id: body.id,
      email: target.email,
      role: body.role,
      isActive: body.isActive,
      entityIds: body.entityIds,
      passwordChanged: Boolean(newHash),
    });
    return NextResponse.json({ ok: true });
  }

  // ---------- reset password ----------

  const problem = passwordProblem(body.password);
  if (problem) return bad(problem);

  const target = await queryOne<{ id: number; email: string }>(
    "select id, email from users where id = $1",
    [body.id],
  );
  if (!target) return bad("No such person.", 404);

  const hash = await hashPassword(body.password);
  await query(
    `update users
        set password_hash = $2, must_change_password = true, updated_at = now()
      where id = $1`,
    [body.id, hash],
  );
  // Everything that person had open is now open on an old password.
  await destroyAllSessionsFor(body.id);

  await audit(actor, "user.resetPassword", { id: body.id, email: target.email });
  return NextResponse.json({ ok: true });
}

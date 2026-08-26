import { NextResponse } from "next/server";
import { z } from "zod";
import { queryOne, transaction } from "@/lib/db";
import { getEntity } from "@/lib/entity";

export const runtime = "nodejs";

/**
 * Vertical housekeeping.
 *
 *   merge   fold an unrecognised tag into a canonical vertical
 *   keep    accept an unrecognised tag as a vertical in its own right
 *   rename  change the display name
 *
 * A merge repoints every fact row and every alias, then deletes the source, so
 * the same raw tag arriving in a future upload lands on the target
 * automatically and the decision never has to be made twice.
 */

const BodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("merge"),
    sourceId: z.number().int().positive(),
    targetId: z.number().int().positive(),
  }),
  z.object({ action: z.literal("keep"), id: z.number().int().positive() }),
  z.object({
    action: z.literal("rename"),
    id: z.number().int().positive(),
    name: z.string().trim().min(1).max(120),
  }),
]);

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const entity = await getEntity();
  if (entity.isGroup) {
    return NextResponse.json(
      { error: "The consolidated view has no books of its own. Switch to a company first." },
      { status: 400 },
    );
  }

  const body = parsed.data;

  try {
    if (body.action === "keep") {
      const updated = await queryOne<{ id: number }>(
        "update verticals set needs_review = false where entity_id = $1 and id = $2 returning id",
        [entity.id, body.id],
      );
      if (!updated) return NextResponse.json({ error: "Vertical not found." }, { status: 404 });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "rename") {
      const updated = await queryOne<{ id: number }>(
        "update verticals set name = $3 where entity_id = $1 and id = $2 returning id",
        [entity.id, body.id, body.name],
      );
      if (!updated) return NextResponse.json({ error: "Vertical not found." }, { status: 404 });
      return NextResponse.json({ ok: true });
    }

    if (body.sourceId === body.targetId) {
      return NextResponse.json(
        { error: "A vertical cannot be merged into itself." },
        { status: 400 },
      );
    }

    const moved = await transaction(async (client) => {
      // Both must belong to this entity - never let an id from another company through.
      const check = await client.query<{ id: number }>(
        "select id from verticals where entity_id = $1 and id = any($2::int[])",
        [entity.id, [body.sourceId, body.targetId]],
      );
      if (check.rowCount !== 2) throw new Error("Vertical not found.");

      // Point every raw tag that resolved to the source at the target, so the
      // next upload of the same tag needs no further decision.
      await client.query(
        "update vertical_aliases set vertical_id = $2 where entity_id = $3 and vertical_id = $1",
        [body.sourceId, body.targetId, entity.id],
      );

      let rows = 0;
      // Every table that carries a vertical_id. payment_allocations is rebuilt
      // from the invoices on the next commit, but it is read by the collections
      // page in the meantime, so it is repointed now rather than left stale.
      for (const table of [
        "gl_entries", "invoice_lines", "payments", "ar_open_items",
        "credit_notes", "payment_allocations",
      ]) {
        const result = await client.query(
          `update ${table} set vertical_id = $2 where entity_id = $3 and vertical_id = $1`,
          [body.sourceId, body.targetId, entity.id],
        );
        rows += result.rowCount ?? 0;
      }

      await client.query("delete from verticals where entity_id = $1 and id = $2", [
        entity.id,
        body.sourceId,
      ]);

      return rows;
    });

    return NextResponse.json({ ok: true, rowsMoved: moved });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not update the vertical.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { getEntity } from "@/lib/entity";

export const runtime = "nodejs";

/**
 * Record or remove one bill under a line of the Other-expenses breakdown.
 *
 * One bill at a time. The reviewer works down the table a line at a time and a
 * form that saved the whole thing at once would put every entry at risk of one
 * mistyped figure.
 *
 * The month is passed rather than taken from the date: a bill dated the 2nd of
 * May can belong to April's costs, which is exactly the case the Excel this
 * replaces carried a remark about.
 */
const Create = z.object({
  action: z.literal("create"),
  fy: z.number().int(),
  month: z.string().regex(/^\d{4}-\d{2}-01$/),
  head: z.string().min(1).max(200),
  label: z.string().min(1).max(200),
  spentOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  vendor: z.string().max(300).nullable(),
  amount: z.number().finite(),
  remark: z.string().max(2000).nullable(),
});

const Remove = z.object({
  action: z.literal("delete"),
  id: z.number().int().positive(),
});

const Body = z.discriminatedUnion("action", [Create, Remove]);

export async function POST(request: Request) {
  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  try {
    const entity = await getEntity();
    if (entity.verticalIds) {
      return NextResponse.json(
        { error: "A partner view has no budget of its own to record against." },
        { status: 400 },
      );
    }

    if (parsed.action === "delete") {
      // Scoped to the entity in the cookie, so one company's view can never
      // reach into another's entries.
      const rows = await query<{ id: number }>(
        "delete from expense_entries where id = $1 and entity_id = $2 returning id",
        [parsed.id, entity.id],
      );
      if (rows.length === 0) {
        return NextResponse.json({ error: "That entry no longer exists." }, { status: 404 });
      }
      return NextResponse.json({ ok: true, deleted: parsed.id });
    }

    const { fy, month, head, label, spentOn, vendor, amount, remark } = parsed;
    const clean = (value: string | null) => (value?.trim() ? value.trim() : null);

    const rows = await query<{ id: number }>(
      `insert into expense_entries
         (entity_id, fy_start_year, head, label, month, spent_on, vendor, amount, remark)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       returning id`,
      [entity.id, fy, head, label, month, spentOn, clean(vendor), amount, clean(remark)],
    );

    return NextResponse.json({ ok: true, id: rows[0].id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not save.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

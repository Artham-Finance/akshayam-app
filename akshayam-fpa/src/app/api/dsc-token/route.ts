import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { getEntity } from "@/lib/entity";
import { apiGuard } from "@/lib/auth/dal";

export const runtime = "nodejs";

/**
 * Record one month's DSC token stock-take - the book quantity and the physical
 * count (qty and value). Book value is not stored here; it is read from the
 * ledger. One row per month, so this replaces rather than appends.
 */
const Body = z.object({
  month: z.string().regex(/^\d{4}-\d{2}-01$/),
  verticalId: z.number().int().positive(),
  bookQty: z.number().finite(),
  physicalQty: z.number().finite(),
  physicalValue: z.number().finite(),
});

export async function POST(request: Request) {
  const { denied } = await apiGuard("expenses.record");
  if (denied) return denied;

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  try {
    const entity = await getEntity();

    // The vertical must be one of this entity's, and it must be DSC - the
    // stock-take has no meaning for any other line.
    const owns = await query<{ id: number }>(
      "select id from verticals where id = $1 and entity_id = $2 and code = 'DSC'",
      [parsed.verticalId, entity.id],
    );
    if (owns.length === 0) {
      return NextResponse.json(
        { error: "Not a DSC vertical for this company." },
        { status: 400 },
      );
    }

    await query(
      `insert into dsc_token_count
         (entity_id, vertical_id, month, book_qty, physical_qty, physical_value)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (entity_id, vertical_id, month)
         do update set book_qty = excluded.book_qty,
                       physical_qty = excluded.physical_qty,
                       physical_value = excluded.physical_value,
                       updated_at = now()`,
      [
        entity.id,
        parsed.verticalId,
        parsed.month,
        parsed.bookQty,
        parsed.physicalQty,
        parsed.physicalValue,
      ],
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not save.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

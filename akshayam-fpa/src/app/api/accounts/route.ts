import { NextResponse } from "next/server";
import { z } from "zod";
import { query, queryOne } from "@/lib/db";
import { getEntity } from "@/lib/entity";
import { apiGuard } from "@/lib/auth/dal";

export const runtime = "nodejs";

const PatchSchema = z.object({
  id: z.number().int().positive(),
  statement: z.enum(["pnl", "bs", "none"]),
  groupCode: z.string().min(1).nullable(),
  cfCategory: z
    .enum(["cash", "non_cash_addback", "wc_operating", "investing", "financing", "pnl"])
    .nullable()
    .optional(),
});

export async function PATCH(request: Request) {
  const { denied } = await apiGuard("accounts.map");
  if (denied) return denied;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const parsed = PatchSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request.", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { id, statement, groupCode, cfCategory } = parsed.data;

  try {
    const entity = await getEntity();

    if (entity.isGroup) {
      return NextResponse.json(
        { error: "The consolidated view has no books of its own. Switch to a company first." },
        { status: 400 },
      );
    }

    // The group must belong to the statement it is being filed under, otherwise
    // the account would silently vanish from both reports.
    if (statement !== "none") {
      if (!groupCode) {
        return NextResponse.json(
          { error: "A reporting line is required unless the account is excluded." },
          { status: 400 },
        );
      }
      const group = await queryOne<{ code: string }>(
        "select code from report_groups where entity_id = $1 and statement = $2::statement_kind and code = $3 and is_subtotal = false",
        [entity.id, statement, groupCode],
      );
      if (!group) {
        return NextResponse.json(
          { error: `"${groupCode}" is not a valid line on that statement.` },
          { status: 400 },
        );
      }
    }

    const updated = await query<{ id: number }>(
      `update accounts
          set statement   = $3::statement_kind,
              group_code  = $4,
              cf_category = coalesce($5, cf_category),
              is_mapped   = true
        where entity_id = $1 and id = $2
        returning id`,
      [entity.id, id, statement, statement === "none" ? null : groupCode, cfCategory ?? null],
    );

    if (updated.length === 0) {
      return NextResponse.json({ error: "Account not found." }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not update the account.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { getEntity } from "@/lib/entity";
import { apiGuard, audit } from "@/lib/auth/dal";

export const runtime = "nodejs";

/**
 * Correct one month of one budget line, in place.
 *
 * The budget itself is loaded a year at a time from the planning workbook
 * (see commitBudget in ingest.ts), which replaces every line wholesale - the
 * right behaviour for a fresh year's plan, wrong for fixing a single number
 * someone typed wrong without disturbing the other thirty-odd lines. This is
 * that second case: one row, by id, updated and nothing else touched.
 *
 * Scoped to the entity in the cookie and audited, the same as an expense
 * actual - a budget figure is one of the things a partner reads as fact.
 */
const Body = z.object({
  id: z.number().int().positive(),
  amount: z.number().finite(),
});

export async function POST(request: Request) {
  const { user, denied } = await apiGuard("expenses.record");
  if (denied) return denied;

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  try {
    const entity = await getEntity();
    if (entity.verticalIds || entity.isGroup) {
      return NextResponse.json(
        { error: "A partner or group view has no budget of its own to edit." },
        { status: 400 },
      );
    }

    const rows = await query<{
      id: number;
      head: string;
      label: string;
      month: string;
      amount: string;
    }>(
      `update expense_budget_lines
          set amount = $1
        where id = $2 and entity_id = $3
        returning id, head, label, month::text, amount::text`,
      [parsed.amount, parsed.id, entity.id],
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: "That budget line no longer exists." }, { status: 404 });
    }

    await audit(user, "expense_budget.edit", {
      entityId: entity.id,
      id: parsed.id,
      head: rows[0].head,
      label: rows[0].label,
      month: rows[0].month,
      amount: parsed.amount,
    });

    return NextResponse.json({ ok: true, id: rows[0].id, amount: Number(rows[0].amount) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not save.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

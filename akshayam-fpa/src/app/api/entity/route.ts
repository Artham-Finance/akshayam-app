import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { queryOne } from "@/lib/db";
import { ENTITY_COOKIE } from "@/lib/entity";
import { apiGuard, userCanSeeEntity } from "@/lib/auth/dal";

export const runtime = "nodejs";

/** Switch the active company. The slug is validated against the database so an
 *  arbitrary cookie value can never take effect. */
export async function POST(request: Request) {
  // Every role may view reports; what varies is which companies.
  const { user, denied } = await apiGuard("reports.view");
  if (denied) return denied;

  let slug: string;
  try {
    const body = await request.json();
    slug = String(body.slug ?? "");
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const entity = await queryOne<{ id: number; slug: string }>(
    "select id, slug from entities where slug = $1",
    [slug],
  );
  if (!entity) {
    return NextResponse.json({ error: "Unknown company." }, { status: 404 });
  }

  // `getEntity` would ignore a cookie naming a company this user may not see,
  // so setting one would be harmless but confusing - the switcher would appear
  // to accept a choice the pages then quietly overrode. Refuse it here instead.
  if (!userCanSeeEntity(user, entity.id)) {
    return NextResponse.json(
      { error: "You do not have access to that company." },
      { status: 403 },
    );
  }

  const store = await cookies();
  store.set(ENTITY_COOKIE, entity.slug, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  return NextResponse.json({ ok: true, slug: entity.slug });
}

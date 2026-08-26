import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { queryOne } from "@/lib/db";
import { ENTITY_COOKIE } from "@/lib/entity";

export const runtime = "nodejs";

/** Switch the active company. The slug is validated against the database so an
 *  arbitrary cookie value can never take effect. */
export async function POST(request: Request) {
  let slug: string;
  try {
    const body = await request.json();
    slug = String(body.slug ?? "");
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const entity = await queryOne<{ slug: string }>(
    "select slug from entities where slug = $1",
    [slug],
  );
  if (!entity) {
    return NextResponse.json({ error: "Unknown company." }, { status: 404 });
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

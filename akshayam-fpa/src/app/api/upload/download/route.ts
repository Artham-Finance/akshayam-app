import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { apiGuard, userCanSeeEntity } from "@/lib/auth/dal";

export const runtime = "nodejs";

/**
 * Hand back the file that was uploaded, byte for byte.
 *
 * The point is checking rather than archiving: when a figure on screen looks
 * wrong the first question is always "what was actually in the file", and the
 * only answer worth having is the file the parser read - not whichever copy is
 * still sitting in someone's Downloads folder under the same name.
 */
export async function GET(request: Request) {
  const { user, denied } = await apiGuard("data.upload");
  if (denied) return denied;

  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Which upload?" }, { status: 400 });
  }

  const row = await queryOne<{
    entity_id: number;
    original_name: string;
    stored_path: string | null;
  }>("select entity_id, original_name, stored_path from uploads where id = $1", [id]);

  /**
   * A file belonging to a company this person has not been granted is reported
   * as missing rather than forbidden. "Forbidden" would confirm that upload 41
   * exists and belongs to someone else, which is more than a stranger to that
   * book should learn from a URL they guessed.
   */
  if (!row || !userCanSeeEntity(user, row.entity_id)) {
    return NextResponse.json({ error: "No such upload." }, { status: 404 });
  }
  if (!row.stored_path) {
    return NextResponse.json(
      {
        error:
          "This upload was read but its file was never written to disk, so there is nothing to hand back. The data it loaded is unaffected.",
      },
      { status: 410 },
    );
  }

  /**
   * The path comes from our own insert, not from the request - but it is still
   * resolved against the upload directory and checked, because a stored path is
   * only ever as trustworthy as every future writer of that column.
   */
  const root = resolve(process.env.UPLOAD_DIR ?? "./storage/uploads");
  const path = resolve(row.stored_path);
  if (path !== root && !path.startsWith(root + sep)) {
    return NextResponse.json({ error: "No such upload." }, { status: 404 });
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch {
    return NextResponse.json(
      { error: "The stored file is no longer on disk." },
      { status: 410 },
    );
  }

  // The name is the one the file arrived under. Quotes and control characters
  // would break the header, so a plain ASCII fallback is offered alongside the
  // UTF-8 form every current browser prefers.
  const safe = row.original_name.replace(/[^\w.\- ]/g, "_");
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": row.original_name.toLowerCase().endsWith(".xls")
        ? "application/vnd.ms-excel"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(row.original_name)}`,
      // A source file never changes once written, but it is also not something
      // to leave in a shared cache.
      "Cache-Control": "private, no-store",
    },
  });
}

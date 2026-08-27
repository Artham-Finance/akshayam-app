import { NextResponse } from "next/server";
import { queryOne, transaction } from "@/lib/db";
import { apiGuard, audit, userCanSeeEntity } from "@/lib/auth/dal";

export const runtime = "nodejs";

/**
 * Remove an upload, and the rows it loaded with it.
 *
 * Re-uploading is the ordinary way to correct a file: a fresh load replaces
 * the period it covers. That is not enough when the wrong file was loaded
 * altogether, because the range it claimed to cover is not the range the right
 * file covers - an AR Aging export booked as receipts spanned a whole year and
 * swallowed the four months of genuine payments underneath it. Loading the
 * right file back only clears its own months and leaves the rest behind.
 *
 * So the upload itself can be withdrawn. Every table that holds loaded rows
 * references the upload and cascades, so removing the one row removes the data
 * it brought.
 */
export async function POST(request: Request) {
  const { user, denied } = await apiGuard("data.delete");
  if (denied) return denied;

  let id: number;
  try {
    id = Number((await request.json()).id);
  } catch {
    return NextResponse.json({ error: "Expected an upload id." }, { status: 400 });
  }
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Which upload?" }, { status: 400 });
  }

  const row = await queryOne<{
    entity_id: number;
    kind: string;
    original_name: string;
    row_count: number | null;
  }>(
    "select entity_id, kind::text as kind, original_name, row_count from uploads where id = $1",
    [id],
  );

  // As with the download: an upload belonging to a company this person has not
  // been granted is reported missing rather than forbidden.
  if (!row || !userCanSeeEntity(user, row.entity_id)) {
    return NextResponse.json({ error: "No such upload." }, { status: 404 });
  }

  await transaction(async (client) => {
    /**
     * Opening balances reference the upload with `on delete set null`, so they
     * would survive it - deliberately, since the balance sheet's opening
     * position should not vanish because a file was tidied away. Withdrawing
     * the upload is the one case where it should, so they go explicitly.
     */
    await client.query("delete from opening_balances where upload_id = $1", [id]);
    await client.query("delete from uploads where id = $1", [id]);
  });

  await audit(user, "upload.delete", {
    uploadId: id,
    kind: row.kind,
    fileName: row.original_name,
    rowCount: row.row_count,
  });

  /**
   * The budgeted P&L is keyed on the company and the year rather than on the
   * upload that brought it, so it is not carried away by this. Said plainly
   * rather than left for the reader to discover from an unchanged dashboard.
   */
  return NextResponse.json({
    ok: true,
    kind: row.kind,
    fileName: row.original_name,
    note:
      row.kind === "budget"
        ? "The upload record is gone, but budget figures are held against the year rather than the file, so they remain until a new planning workbook replaces them."
        : null,
  });
}

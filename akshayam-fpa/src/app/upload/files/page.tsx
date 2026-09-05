import { DataTable } from "@/components/DataTable";
import { SetupRequired } from "@/components/SetupRequired";
import { UploadRowActions } from "@/components/UploadRowActions";
import { Card, EmptyState, Notice, PageHeader } from "@/components/ui";
import { query } from "@/lib/db";
import { getEntity } from "@/lib/entity";
import { dateLabel } from "@/lib/format";
import { kindTitle } from "@/lib/upload-kinds";
import { can, requirePermissionAndEntity } from "@/lib/auth/dal";

export const dynamic = "force-dynamic";

/** Bytes as a person reads them. Files here are spreadsheets, so KB and MB do. */
function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface Row {
  id: number;
  kind: string;
  original_name: string;
  stored_path: string | null;
  byte_size: string | number;
  row_count: number | null;
  period_start: string | null;
  period_end: string | null;
  uploaded_on: string;
  uploaded_time: string;
  entity_name: string;
  uploaded_by: string | null;
}

/**
 * Every file that was uploaded, and the file itself back again.
 *
 * The register exists to answer one question - what did the dashboard actually
 * read - so it shows what the parser made of each file next to the file: the
 * rows it took, the period it covered, and who sent it. Superseded uploads stay
 * listed rather than being tidied away, because "which version was loaded when
 * that number changed" is exactly the thing worth being able to look up.
 */
export default async function UploadedFilesPage() {
  await requirePermissionAndEntity("data.upload");
  const canDelete = await can("data.delete");
  try {
    const entity = await getEntity();

    const rows = await query<Row>(
      `select u.id, u.kind::text as kind, u.original_name, u.stored_path, u.byte_size,
              u.row_count, u.period_start, u.period_end,
              to_char(u.created_at, 'YYYY-MM-DD') as uploaded_on,
              to_char(u.created_at, 'HH24:MI')     as uploaded_time,
              e.name as entity_name,
              coalesce(usr.name, usr.email) as uploaded_by
         from uploads u
         join entities e on e.id = u.entity_id
         left join users usr on usr.id = u.uploaded_by
        where u.entity_id = any($1::int[]) and u.status = 'committed'
        order by u.created_at desc`,
      [entity.memberIds],
    );

    const missing = rows.filter((r) => !r.stored_path).length;

    return (
      <>
        <PageHeader
          title="Uploaded files"
          subtitle={`${entity.name} · every report loaded, newest first · download one to check what the dashboard read`}
        />

        <div className="space-y-4">
          {canDelete && (
            <Notice tone="info" title="Removing an upload takes its rows with it">
              Loading a corrected file over a bad one only replaces the period the new file
              covers, which is not enough when the wrong report was loaded altogether — an AR
              Aging export booked as receipts spans a whole year and swallows the months of
              genuine payments underneath it. Remove that upload instead and the rows go with
              it.
            </Notice>
          )}

          {missing > 0 && (
            <Notice tone="info" title={`${missing} of these files were not kept`}>
              Their data loaded normally and the dashboard is unaffected — only the original
              spreadsheet was not written to disk, so there is nothing to hand back. Files
              uploaded from now on are kept.
            </Notice>
          )}

          {rows.length === 0 ? (
            <EmptyState title="Nothing uploaded yet" href="/upload" cta="Go to Upload">
              Every report loaded through the Upload tab is listed here, with the original
              file available to download.
            </EmptyState>
          ) : (
            <Card padded={false}>
              <DataTable
                columns={[
                  ...(entity.isGroup ? [{ header: "Company" }] : []),
                  { header: "Report" },
                  { header: "File" },
                  { header: "Rows", numeric: true },
                  { header: "Period covered" },
                  { header: "Uploaded" },
                  { header: "By" },
                  { header: "Size", numeric: true },
                  { header: "" },
                ]}
                rows={rows.map((r) => [
                  ...(entity.isGroup ? [r.entity_name] : []),
                  kindTitle(r.kind),
                  <span key="n" className="text-ink">
                    {r.original_name}
                  </span>,
                  r.row_count === null ? "—" : r.row_count.toLocaleString("en-IN"),
                  r.period_start
                    ? `${dateLabel(r.period_start)} — ${dateLabel(r.period_end)}`
                    : "—",
                  `${dateLabel(r.uploaded_on)} · ${r.uploaded_time}`,
                  r.uploaded_by ?? "—",
                  fileSize(Number(r.byte_size)),
                  <UploadRowActions
                    key="a"
                    id={r.id}
                    fileName={r.original_name}
                    hasFile={!!r.stored_path}
                    canDelete={canDelete}
                  />,
                ])}
                /* What has been loaded in total: how many files, how many rows
                   of data behind them, and how much disk the originals take. */
                footer={[
                  ...(entity.isGroup ? [""] : []),
                  `Total — ${rows.length} file${rows.length === 1 ? "" : "s"}`,
                  "",
                  rows
                    .reduce((t, r) => t + (r.row_count ?? 0), 0)
                    .toLocaleString("en-IN"),
                  "",
                  "",
                  "",
                  fileSize(rows.reduce((t, r) => t + Number(r.byte_size ?? 0), 0)),
                  "",
                ]}
                emptyMessage="Nothing uploaded yet."
              />
            </Card>
          )}
        </div>
      </>
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not reach the database.";
    return <SetupRequired message={message} />;
  }
}

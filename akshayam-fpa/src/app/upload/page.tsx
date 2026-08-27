import { SetupRequired } from "@/components/SetupRequired";
import { UploadForm, type UploadKindInfo } from "@/components/UploadForm";
import { CompanyOnly, Notice, PageHeader } from "@/components/ui";
import { query } from "@/lib/db";
import { getEntity } from "@/lib/entity";
import { UPLOAD_KINDS } from "@/lib/upload-kinds";
import { requirePermissionAndEntity } from "@/lib/auth/dal";

export const dynamic = "force-dynamic";

export default async function UploadPage() {
  await requirePermissionAndEntity("data.upload");
  try {
    const entity = await getEntity();
    if (entity.isGroup) {
      return (
        <>
          <PageHeader title="Upload reports" />
          <CompanyOnly what="Uploading Zoho exports" />
        </>
      );
    }

    const recent = await query<{
      kind: string;
      original_name: string;
      row_count: number | null;
      period_start: string | null;
      period_end: string | null;
      created_at: string;
    }>(
      `select distinct on (kind)
              kind, original_name, row_count, period_start, period_end, created_at
         from uploads
        where entity_id = any($1::int[]) and status = 'committed'
        order by kind, created_at desc`,
      [entity.memberIds],
    );

    const lastByKind = new Map(recent.map((r) => [r.kind, r]));

    const kinds: UploadKindInfo[] = UPLOAD_KINDS.map((info) => {
      const last = lastByKind.get(info.kind);
      return {
        ...info,
        lastUpload: last
          ? {
              fileName: last.original_name,
              rowCount: last.row_count,
              periodStart: last.period_start,
              periodEnd: last.period_end,
              createdAt: String(last.created_at),
            }
          : null,
      };
    });

    return (
      <>
        <PageHeader
          title="Upload reports"
          subtitle="Drop a Zoho Books export in and the dashboard updates. Nothing is overwritten until the file reads cleanly."
        />

        <div className="space-y-4">
          <Notice tone="info" title="Start with the general ledger">
            If you only upload one file, make it the general ledger — it produces the P&amp;L,
            balance sheet and cash flow on its own. Add the opening trial balance once so the
            balance sheet has a starting point, then the three sales reports for the revenue
            and receivables views.
          </Notice>

          <UploadForm kinds={kinds} />
        </div>
      </>
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not reach the database.";
    return <SetupRequired message={message} />;
  }
}

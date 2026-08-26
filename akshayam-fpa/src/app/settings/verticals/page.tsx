import { SetupRequired } from "@/components/SetupRequired";
import { VerticalMapper, type VerticalRow } from "@/components/VerticalMapper";
import { CompanyOnly, EmptyState, Notice, PageHeader } from "@/components/ui";
import { query } from "@/lib/db";
import { getEntity } from "@/lib/entity";

export const dynamic = "force-dynamic";

export default async function VerticalSettingsPage() {
  try {
    const entity = await getEntity();
    if (entity.isGroup) {
      return (
        <>
          <PageHeader title="Verticals" />
          <CompanyOnly what="Reporting-tag housekeeping" />
        </>
      );
    }

    const rows = await query<{
      id: number;
      code: string;
      name: string;
      needs_review: boolean;
      rows: number;
      activity: number;
    }>(
      `select v.id, v.code, v.name, v.needs_review,
              count(g.id)::int                          as rows,
              coalesce(sum(abs(g.debit - g.credit)), 0)::numeric as activity
         from verticals v
         left join gl_entries g on g.vertical_id = v.id
        where v.entity_id = $1
        group by v.id, v.code, v.name, v.needs_review
        order by v.sort_order, v.name`,
      [entity.id],
    );

    if (rows.length === 0) {
      return (
        <>
          <PageHeader title="Verticals" />
          <EmptyState title="No verticals yet" href="/upload" cta="Upload the general ledger">
            Verticals come from the reporting tags on your Zoho ledger. Upload a general
            ledger and they appear here.
          </EmptyState>
        </>
      );
    }

    const verticals: VerticalRow[] = rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      needsReview: r.needs_review,
      rows: r.rows,
      activity: Number(r.activity),
    }));

    const pending = verticals.filter((v) => v.needsReview).length;

    return (
      <>
        <PageHeader
          title="Verticals"
          subtitle={`${entity.name} · fold old or stray reporting tags into your current verticals`}
        />

        <div className="space-y-4">
          <Notice tone="info" title="Why tags need folding">
            Zoho reporting tags are free text, and your vertical names changed with FY
            2026-27. Anything that does not match a current vertical is listed below rather
            than guessed at &mdash; folding <span className="font-medium">NCLT</span> into
            Disputes &amp; Litigation may well be right, but that is your call, not the
            app&rsquo;s. Merging repoints the history and remembers the decision, so the same
            tag never has to be sorted twice.
          </Notice>

          {pending > 0 && (
            <Notice tone="caution" title={`${pending} tag${pending === 1 ? "" : "s"} not yet assigned`}>
              Until these are folded in, a vertical-wise P&amp;L will spread the same work
              across several lines and understate each one.
            </Notice>
          )}

          <VerticalMapper verticals={verticals} />
        </div>
      </>
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not reach the database.";
    return <SetupRequired message={message} />;
  }
}

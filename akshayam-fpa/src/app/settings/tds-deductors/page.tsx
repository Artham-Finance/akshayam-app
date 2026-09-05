import {
  DeductorMapper,
  type ExistingAlias,
  type UnmatchedDeductor,
} from "@/components/DeductorMapper";
import { SetupRequired } from "@/components/SetupRequired";
import { CompanyOnly, EmptyState, Notice, PageHeader } from "@/components/ui";
import { query } from "@/lib/db";
import { getEntity } from "@/lib/entity";
import { requirePermissionAndEntity } from "@/lib/auth/dal";

export const dynamic = "force-dynamic";

export default async function TdsDeductorSettingsPage() {
  await requirePermissionAndEntity("accounts.map");

  try {
    const entity = await getEntity();
    if (entity.isGroup) {
      return (
        <>
          <PageHeader title="TDS deductors" />
          <CompanyOnly what="Deductor mapping" />
        </>
      );
    }

    const [loaded, unmatchedRows, aliasRows, customerRows] = await Promise.all([
      query<{ n: number }>("select count(*)::int n from tds_entries where entity_id = $1", [
        entity.id,
      ]),
      query<{ deductor_name: string; tan: string | null; lines: number; tax: number }>(
        `select deductor_name, max(tan) as tan,
                count(*)::int as lines,
                coalesce(sum(tax_deducted),0)::numeric as tax
           from tds_entries
          where entity_id = $1 and customer_name is null
          group by deductor_name
          order by tax desc`,
        [entity.id],
      ),
      /*
        What each hand-made mapping is now carrying. The alias key is the
        normalised deductor name, so the entries it governs are found the same
        way the matcher finds them.
      */
      query<{ deductor_key: string; customer_name: string; lines: number; tax: number }>(
        `select al.deductor_key, al.customer_name,
                coalesce(count(t.id), 0)::int as lines,
                coalesce(sum(t.tax_deducted), 0)::numeric as tax
           from tds_deductor_aliases al
           left join tds_entries t
             on t.entity_id = al.entity_id and t.customer_name = al.customer_name
          where al.entity_id = $1
          group by al.deductor_key, al.customer_name
          order by tax desc, al.deductor_key`,
        [entity.id],
      ),
      query<{ customer_name: string }>(
        `select distinct customer_name from (
           select entity_id, customer_name from invoice_lines
           union select entity_id, customer_name from ar_open_items
           union select entity_id, customer_name from payments) x
          where entity_id = $1 and customer_name is not null
          order by customer_name`,
        [entity.id],
      ),
    ]);

    if ((loaded[0]?.n ?? 0) === 0) {
      return (
        <>
          <PageHeader title="TDS deductors" />
          <EmptyState title="No Form 26AS loaded" href="/upload" cta="Upload Form 26AS">
            Deductors appear here once an annual tax statement has been uploaded. Names that
            cannot be joined to a customer automatically are listed for you to map.
          </EmptyState>
        </>
      );
    }

    const unmatched: UnmatchedDeductor[] = unmatchedRows.map((r) => ({
      deductorName: r.deductor_name,
      tan: r.tan,
      lines: r.lines,
      taxDeducted: Number(r.tax),
    }));

    const aliases: ExistingAlias[] = aliasRows.map((r) => ({
      deductorKey: r.deductor_key,
      customerName: r.customer_name,
      lines: r.lines,
      taxDeducted: Number(r.tax),
    }));

    return (
      <>
        <PageHeader
          title="TDS deductors"
          subtitle={`${entity.name} · match Form 26AS deductor names to customers`}
        />

        <div className="space-y-4">
          <Notice tone="info" title="Why these need mapping">
            Form 26AS names a deductor as it is registered with the income tax department
            &mdash; <span className="font-medium">RAM NATH AND CO PRIVATE LIMITED</span> &mdash;
            while Zoho names the same party as the firm bills it. Most join on a normalised
            form automatically. The rest are listed here rather than guessed at, because
            putting a tax credit against the wrong customer is worse than leaving it
            unattributed. Saving a mapping re-reconciles immediately, and it is remembered, so
            the next statement resolves the name on its own.
          </Notice>

          <DeductorMapper
            unmatched={unmatched}
            aliases={aliases}
            customers={customerRows.map((r) => r.customer_name)}
          />
        </div>
      </>
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not reach the database.";
    return <SetupRequired message={message} />;
  }
}

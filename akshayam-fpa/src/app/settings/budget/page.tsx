import { CompanyOnly, EmptyState, Notice, PageHeader } from "@/components/ui";
import { ExpenseBudgetEditor, type BudgetLineRow } from "@/components/ExpenseBudgetEditor";
import { query } from "@/lib/db";
import { getEntity } from "@/lib/entity";
import { fyLabel, fyMonths } from "@/lib/period";
import { requirePermissionAndEntity } from "@/lib/auth/dal";

export const dynamic = "force-dynamic";

/**
 * Correct a single budget line without a full re-upload.
 *
 * The planning workbook is still where a year's budget starts - this exists
 * for the case after that, where one number in one month turned out wrong
 * and re-uploading the whole workbook either isn't practical (nobody has an
 * updated copy to hand) or would be overkill for one figure. Every other
 * month of every other line is left exactly as the workbook set it.
 */
export default async function BudgetSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePermissionAndEntity("expenses.record");
  const entity = await getEntity();

  if (entity.isGroup || entity.verticalIds) {
    return (
      <>
        <PageHeader title="Budget" />
        <CompanyOnly what="The expense budget" slice={!!entity.verticalIds} companies={2} />
      </>
    );
  }

  const years = await query<{ fy_start_year: number }>(
    `select distinct fy_start_year from expense_budget_lines where entity_id = $1 order by fy_start_year desc`,
    [entity.id],
  );
  if (years.length === 0) {
    return (
      <>
        <PageHeader title="Budget" />
        <EmptyState title="No budget loaded yet" href="/upload" cta="Upload the planning workbook">
          The Other-expenses budget comes from the planning workbook. Upload it once and its
          lines appear here to correct.
        </EmptyState>
      </>
    );
  }

  const params = await searchParams;
  const requestedFy = Number(params.fy);
  const fyStartYear = years.some((y) => y.fy_start_year === requestedFy)
    ? requestedFy
    : years[0].fy_start_year;

  const rows = await query<{
    id: number;
    head: string;
    label: string;
    month: string;
    amount: string;
    sort_order: number;
  }>(
    `select id, head, label, to_char(month, 'YYYY-MM') as month, amount::text, sort_order
       from expense_budget_lines
      where entity_id = $1 and fy_start_year = $2
      order by sort_order, head, label, month`,
    [entity.id, fyStartYear],
  );

  const months = fyMonths(fyStartYear, entity.fy_start_month);

  const lineIndex = new Map<string, BudgetLineRow>();
  const lines: BudgetLineRow[] = [];
  for (const row of rows) {
    const key = `${row.head}|${row.label}`;
    let line = lineIndex.get(key);
    if (!line) {
      line = { head: row.head, label: row.label, months: {} };
      lineIndex.set(key, line);
      lines.push(line);
    }
    line.months[row.month] = { id: row.id, amount: Number(row.amount) };
  }

  return (
    <>
      <PageHeader
        title="Budget"
        subtitle={`${entity.name} · ${fyLabel(fyStartYear)} · correct one figure without a re-upload`}
      />

      <div className="space-y-4">
        <Notice tone="info" title="Changes take effect immediately">
          Editing a cell here changes what every report reads for that month - the P&amp;L,
          Budget vs Actual and the Other-expenses breakdown all pick it up as soon as you
          reload them. A full re-upload of the planning workbook will still replace every line
          for the year, including anything corrected here.
        </Notice>

        {years.length > 1 && (
          <div className="flex items-center gap-2 text-[13px]">
            <span className="text-ink-muted">Year</span>
            <div className="flex gap-1">
              {years.map((y) => (
                <a
                  key={y.fy_start_year}
                  href={`/settings/budget?fy=${y.fy_start_year}`}
                  className={
                    y.fy_start_year === fyStartYear
                      ? "rounded-md bg-navy px-2.5 py-1 font-medium text-ink-invert"
                      : "rounded-md border border-line px-2.5 py-1 text-ink-muted hover:bg-surface-sunk"
                  }
                >
                  {fyLabel(y.fy_start_year)}
                </a>
              ))}
            </div>
          </div>
        )}

        <ExpenseBudgetEditor lines={lines} months={months} />
      </div>
    </>
  );
}

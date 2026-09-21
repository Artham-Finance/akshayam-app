import { DataTable, type Column } from "@/components/DataTable";
import { Card, CardTitle, DownloadExcel, EmptyState, KpiTile, PageHeader } from "@/components/ui";
import { getAvailableFinancialYears, getEntity } from "@/lib/entity";
import { dateLabel, money } from "@/lib/format";
import { fyBounds } from "@/lib/period";
import { getReportingPeriod, ledgerWrittenTo } from "@/lib/reporting-period";
import {
  buildReimbursementReco,
  hasReimbursementBillLines,
  type RecoRow,
} from "@/lib/reports/reimbursement-reco";
import { requireEntityAccess } from "@/lib/auth/dal";

export const dynamic = "force-dynamic";

/**
 * RE / RI reconciliation.
 *
 * Three lists, not one table: a reimbursable expense and the invoice that
 * recovers it are matched by the RI number someone typed into the expense
 * line at booking time, and the two sides drift out of step in opposite
 * directions - a bill entered with no RI raised yet, and an RI raised for a
 * cost that never got its own bill line (or was booked without the RI number
 * on it). Both are worklists in their own right; only the matched list is
 * "done".
 *
 * Scoped by the whole financial year, not the header's own period - a
 * reconciliation is a running position, not a month's slice, and narrowing it
 * to This Month would just hide most of both worklists.
 */
export default async function ReimbursementsPage() {
  await requireEntityAccess();

  const entity = await getEntity();
  const columns: Column[] = [
    { header: "Entity" },
    { header: "RI reference" },
    { header: "Bill date" },
    { header: "Vendor" },
    { header: "Client" },
    { header: "RE amount", numeric: true },
    { header: "RI date" },
    { header: "RI client" },
    { header: "RI amount", numeric: true },
  ];

  if (!(await hasReimbursementBillLines(entity.memberIds, entity.verticalIds))) {
    return (
      <>
        <PageHeader title="RE / RI Reconciliation" />
        <EmptyState title="No reimbursement bill detail loaded" href="/upload" cta="Upload Bills (item-wise)">
          This reconciliation reads the RI number typed into each reimbursable-expense bill line -
          not carried by the General Ledger export, only by Zoho&apos;s item-wise Bills export.
          Upload that file and this page fills in.
        </EmptyState>
      </>
    );
  }

  const availableYears = await getAvailableFinancialYears(entity.memberIds);
  const preview = await getReportingPeriod(entity, availableYears);
  const writtenTo = await ledgerWrittenTo(entity.memberIds, preview.fyStartYear);
  const period = await getReportingPeriod(entity, availableYears, writtenTo);
  const { start, end } = fyBounds(period.fyStartYear, entity.fy_start_month);

  const reco = await buildReimbursementReco({ entity, start, end, fyStartYear: period.fyStartYear });
  const showEntity = entity.isGroup;

  const row = (r: RecoRow) => [
    ...(showEntity ? [r.entityName] : []),
    r.riRef ?? "—",
    r.reDate ? dateLabel(r.reDate) : "—",
    r.reVendor ?? "—",
    r.reCustomer ?? "—",
    r.reAmount !== null ? money(r.reAmount) : "—",
    r.riDate ? dateLabel(r.riDate) : "—",
    r.riCustomer ?? "—",
    r.riAmount !== null ? money(r.riAmount) : "—",
  ];

  const activeColumns = showEntity ? columns : columns.slice(1);

  return (
    <>
      <PageHeader
        title="RE / RI Reconciliation"
        subtitle={`${entity.name} · FY ${period.fyStartYear}-${String(period.fyStartYear + 1).slice(2)} · ledger posted through ${dateLabel(writtenTo ?? end)}`}
        actions={<DownloadExcel href={`/api/export/reimbursement-reco?fy=${period.fyStartYear}`} />}
      />

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiTile
          label="RI still needs raising"
          value={reco.totals.reNeedsRiCount}
          note={money(reco.totals.reNeedsRiAmount)}
          tone={reco.totals.reNeedsRiCount > 0 ? "caution" : "positive"}
        />
        <KpiTile
          label="RI raised, RE not accounted"
          value={reco.totals.riOnlyCount}
          note={money(reco.totals.riOnlyAmount)}
          tone={reco.totals.riOnlyCount > 0 ? "caution" : "positive"}
        />
        <KpiTile
          label="Matched"
          value={reco.totals.matchedCount}
          note={money(reco.totals.matchedAmount)}
          tone="positive"
        />
        <KpiTile
          label="No RI number on the bill line"
          value={reco.totals.reNotTaggedCount}
          note={money(reco.totals.reNotTaggedAmount)}
          tone={reco.totals.reNotTaggedCount > 0 ? "caution" : "positive"}
        />
        <KpiTile
          label="Prior-year reference — can't verify"
          value={reco.totals.rePriorYearCount}
          note={money(reco.totals.rePriorYearAmount)}
          tone="ink"
        />
      </div>

      <div className="space-y-6">
        <Card padded={false}>
          <div className="p-4 pb-0 sm:p-5 sm:pb-0">
            <CardTitle
              hint={`${reco.totals.reNeedsRiCount} line(s) · ${money(reco.totals.reNeedsRiAmount)}`}
            >
              RI still needs raising
            </CardTitle>
            <p className="-mt-2 mb-3 text-[11.5px] text-ink-muted">
              Booked to a reimbursement account, names an RI number for this financial year, and
              that number is not on the ledger — the real worklist: these are outstanding.
            </p>
          </div>
          <DataTable
            columns={activeColumns}
            rows={reco.reNeedsRi.map(row)}
            emptyMessage="Nothing outstanding — every RI-tagged expense this year has been raised."
          />
        </Card>

        <Card padded={false}>
          <div className="p-4 pb-0 sm:p-5 sm:pb-0">
            <CardTitle hint={`${reco.totals.riOnlyCount} line(s) · ${money(reco.totals.riOnlyAmount)}`}>
              RI raised — RE not accounted
            </CardTitle>
            <p className="-mt-2 mb-3 text-[11.5px] text-ink-muted">
              An RI invoice was raised, but no reimbursement-expense bill line names its number —
              either the cost was never booked, or it was booked without the RI number on it.
            </p>
          </div>
          <DataTable
            columns={activeColumns}
            rows={reco.riOnly.map(row)}
            emptyMessage="Nothing outstanding — every RI raised this year has a matching bill line."
          />
        </Card>

        <Card padded={false}>
          <div className="p-4 pb-0 sm:p-5 sm:pb-0">
            <CardTitle
              hint={`${reco.totals.reNotTaggedCount} line(s) · ${money(reco.totals.reNotTaggedAmount)}`}
            >
              No RI number on the bill line
            </CardTitle>
            <p className="-mt-2 mb-3 text-[11.5px] text-ink-muted">
              Booked to a reimbursement account, but the bill line&apos;s own description carries no
              RI number at all — nothing to match against until one is added and the file is
              re-uploaded.
            </p>
          </div>
          <DataTable
            columns={activeColumns}
            rows={reco.reNotTagged.map(row)}
            emptyMessage="Every reimbursement-account line this year names an RI number."
          />
        </Card>

        <Card padded={false}>
          <div className="p-4 pb-0 sm:p-5 sm:pb-0">
            <CardTitle
              hint={`${reco.totals.rePriorYearCount} line(s) · ${money(reco.totals.rePriorYearAmount)}`}
            >
              Prior-year reference — can&apos;t verify
            </CardTitle>
            <p className="-mt-2 mb-3 text-[11.5px] text-ink-muted">
              Names an RI number from a different financial year, so this year&apos;s ledger cannot
              say whether it was ever raised. Upload that year&apos;s General Ledger to check it.
            </p>
          </div>
          <DataTable
            columns={activeColumns}
            rows={reco.rePriorYear.map(row)}
            emptyMessage="No prior-year references this year."
          />
        </Card>

        <Card padded={false}>
          <div className="p-4 pb-0 sm:p-5 sm:pb-0">
            <CardTitle hint={`${reco.totals.matchedCount} line(s) · ${money(reco.totals.matchedAmount)}`}>
              RE accounted — RI raised — matched
            </CardTitle>
          </div>
          <DataTable
            columns={activeColumns}
            rows={reco.matched.map(row)}
            emptyMessage="No matches yet this year."
          />
        </Card>
      </div>
    </>
  );
}

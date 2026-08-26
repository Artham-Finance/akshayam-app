import { SetupRequired } from "@/components/SetupRequired";
import { UploadForm, type UploadKindInfo } from "@/components/UploadForm";
import { CompanyOnly, Notice, PageHeader } from "@/components/ui";
import { query } from "@/lib/db";
import { getEntity } from "@/lib/entity";

export const dynamic = "force-dynamic";

const KINDS: Omit<UploadKindInfo, "lastUpload">[] = [
  {
    kind: "gl",
    title: "General Ledger",
    zohoPath: "Reports → Accountant → General Ledger",
    blurb:
      "The backbone of the whole dashboard. Every P&L, balance sheet and cash flow figure is derived from this one file, and each number stays clickable back to the transactions behind it. Export the full financial year; re-uploading a period simply replaces it.",
    cadence: "Monthly",
    needsAsOf: false,
  },
  {
    kind: "opening_tb",
    title: "Opening Trial Balance",
    zohoPath: "Reports → Accountant → Trial Balance",
    blurb:
      "The closing trial balance of the previous financial year. The ledger alone cannot tell us what the balance sheet opened at, so this seeds it. Needed once a year.",
    cadence: "Once a year",
    needsAsOf: true,
    asOfLabel: "As at",
  },
  {
    kind: "invoices",
    title: "Invoice Details",
    zohoPath: "Reports → Sales → Invoice Details",
    blurb:
      "Drives the revenue view: billing by month, client, vertical and salesperson, plus client concentration.",
    cadence: "Weekly",
    needsAsOf: false,
  },
  {
    kind: "credit_notes",
    title: "Credit Note Details",
    zohoPath: "Reports → Sales → Credit Note Details",
    blurb:
      "Credit notes reduce revenue in the ledger but never appear in Invoice Details, so without this file the Revenue page reads high against the P&L. One credit note applied to several invoices is exported once per invoice; it is counted once.",
    cadence: "Weekly",
    needsAsOf: false,
  },
  {
    kind: "retainers",
    title: "Recurring Retainership Fee",
    zohoPath: "Reports → Sales → Sales by Item",
    blurb:
      "Splits revenue between the monthly retainer and one-off professional work — the split shown on the Revenue page and in Budget vs Actual. Two shapes are read: one row per customer per month (customer_name, amount, Month), or the hand-kept table with one column per month. Re-uploading replaces every month the file covers, so a corrected list fixes itself.",
    cadence: "Monthly",
    needsAsOf: false,
  },
  {
    kind: "payments",
    title: "Customer Payments",
    zohoPath: "Reports → Sales → Customer Payments",
    blurb: "Drives collections and DSO — what was billed against what actually came in.",
    cadence: "Weekly",
    needsAsOf: false,
  },
  {
    kind: "ar_aging",
    title: "AR Aging Details",
    zohoPath: "Reports → Receivables → AR Aging Details",
    blurb:
      "A snapshot of what is outstanding and how old it is. Each upload is a dated snapshot, so the trend builds up over time.",
    cadence: "Weekly",
    needsAsOf: true,
    asOfLabel: "Snapshot date",
  },
];

export default async function UploadPage() {
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

    const kinds: UploadKindInfo[] = KINDS.map((info) => {
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

import type { UploadKindInfo } from "@/components/UploadForm";

/**
 * The catalogue of reports the app accepts.
 *
 * Kept here rather than beside the upload form because two screens need it and
 * they must not drift: the Upload tab describes each report to whoever is about
 * to send one, and the Download tab names the same report against the file that
 * was sent. A kind whose title differed between the two would read as two
 * different things.
 */
export const UPLOAD_KINDS: Omit<UploadKindInfo, "lastUpload">[] = [
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
    kind: "budget",
    title: "Budget — planning workbook",
    zohoPath: "Not a Zoho report — the firm's own planning workbook",
    blurb:
      "The budgeted P&L, month by month, and the breakdown behind Other expenses. Without it every page shows actuals with nothing to compare them against. One file covers the group and both companies — it loads all three whichever view you drop it on, and replaces the whole year rather than adding to it. Vertical revenue and collection targets are separate and already set up.",
    cadence: "Once a year",
    needsAsOf: false,
  },
  {
    kind: "invoices",
    title: "Invoice Details",
    zohoPath: "Reports → Sales → Invoice Details",
    blurb:
      "Drives the revenue view: billing by month, client, vertical and salesperson, plus client concentration. " +
      "Export any span you like — a file replaces exactly the dates it covers and leaves every other period alone, " +
      "so a back-year export loaded alongside the weekly one adds history without disturbing the current week. " +
      "Worth doing once: a receipt settling an invoice raised before the ledger starts cannot be matched to it, " +
      "and shows up on Collections as untraceable until the invoice it pays is loaded.",
    cadence: "Weekly, plus prior years once",
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
    blurb:
      "Drives collections and DSO — what was billed against what actually came in. " +
      "Like Invoice Details, a file replaces exactly the dates it covers, so prior years can be loaded " +
      "alongside the weekly export without touching it.",
    cadence: "Weekly, plus prior years once",
    needsAsOf: false,
  },
  {
    kind: "tds_26as",
    title: "Form 26AS — TDS credits",
    zohoPath: "Not a Zoho report — income tax portal → e-File → Income Tax Returns → View Form 26AS",
    blurb:
      "The income tax department's record of what customers deducted and deposited against the firm's PAN. Reconciled on the Receivables tab against the TDS receivable the books raise when an invoice is approved. Download the tax year as XLSX; re-uploading replaces the period rather than adding to it, which is what you want because the department revises entries as deductors file corrections.",
    cadence: "Quarterly",
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
  {
    kind: "osb_entries",
    title: "OSB Entries — Revenue transfer to RBJV",
    zohoPath: "Not a Zoho report — a hand-maintained list of the invoices transferred",
    blurb:
      "For Akshayam: invoices raised through GIFT where a portion of the value is really RBJV's " +
      "own team's work. Shown as its own card on the P&L (no ledger entry of its own to fold " +
      "into the statement) and deducted from GIFT's revenue and collection actuals on the " +
      "Revenue and Collections tabs. Replaces the whole list on every upload — remove a row " +
      "from the file and it disappears here too.",
    cadence: "Weekly",
    needsAsOf: false,
  },
  {
    kind: "reimbursement_bills",
    title: "Bills — item-wise (for RE / RI reconciliation)",
    zohoPath: "Purchases → Bills → Export (item-wise), or Settings → Import/Export → Export Data",
    blurb:
      "Only the reimbursable-expense (RE) lines feed the RE / RI Reconciliation view: the General Ledger " +
      "export collapses a bill's line items and loses the RI number typed into each one, so this narrower, " +
      "item-level export is read instead, and only lines booked to a reimbursement account are kept. " +
      "A file replaces exactly the bill dates it covers.",
    cadence: "Weekly",
    needsAsOf: false,
  },
];

/** The report title behind a stored upload's `kind`. */
export function kindTitle(kind: string): string {
  return UPLOAD_KINDS.find((k) => k.kind === kind)?.title ?? kind;
}

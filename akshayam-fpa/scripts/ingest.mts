/**
 * Command-line ingest, for loading a company's books without the browser.
 *
 * The upload page posts one file at a time and is the right tool when a single
 * report is being refreshed. Loading a whole company from scratch is a
 * different job: five files, in a specific order, against a named entity - and
 * it wants to be repeatable, because the mapping review that follows is easier
 * to redo than to undo.
 *
 *   node --env-file-if-exists=.env.local scripts/ingest.mts <entity-slug> \
 *        [--gl f.xlsx] [--tb f.xlsx --as-of 2026-03-31] [--invoices f.xlsx] \
 *        [--payments f.xlsx] [--ar f.xlsx [--as-of-ar 2026-08-25]] \
 *        [--credit-notes f.xlsx] [--retainers f.xlsx]
 *
 * Files are committed in the order the pipeline needs: ledger and trial
 * balance first so accounts exist, then the sales reports, whose cross-links
 * are rebuilt after each commit.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { pool } from "../src/lib/db";
import {
  commitArAging,
  commitCreditNotes,
  commitGeneralLedger,
  commitInvoices,
  commitPayments,
  commitRetainers,
  commitTrialBalance,
  type CommitResult,
} from "../src/lib/ingest";
import { parseGeneralLedger } from "../src/lib/parse/gl";
import { parseArAging, parseCreditNotes, parseInvoices, parsePayments } from "../src/lib/parse/sales";
import { parseRetainers } from "../src/lib/parse/retainers";
import { parseTrialBalance } from "../src/lib/parse/tb";

const args = process.argv.slice(2);
const slug = args[0];
if (!slug || slug.startsWith("--")) {
  console.error("usage: node scripts/ingest.mts <entity-slug> [--gl file] [--tb file --as-of date] ...");
  process.exit(1);
}

function flag(name: string): string | null {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : null;
}

const entity = (
  await pool.query<{ id: number; name: string }>("select id, name from entities where slug = $1", [slug])
).rows[0];
if (!entity) {
  console.error(`No entity with slug "${slug}".`);
  process.exit(1);
}
console.log(`Ingesting into ${entity.name} (entity ${entity.id})\n`);

function meta(path: string) {
  const bytes = readFileSync(path);
  return {
    bytes,
    meta: {
      originalName: basename(path),
      byteSize: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      storedPath: null,
    },
  };
}

function report(label: string, result: CommitResult, warnings: string[] = []) {
  console.log(`${label}: ${result.rowsInserted} rows`);
  if (result.newAccounts.length) console.log(`   new accounts:  ${result.newAccounts.length}`);
  if (result.newVerticals.length) console.log(`   new verticals: ${result.newVerticals.join(", ")}`);
  if (result.needsReview.length) console.log(`   needs review:  ${result.needsReview.length} account(s)`);
  for (const w of warnings) console.log(`   ! ${w}`);
  console.log();
}

const gl = flag("gl");
if (gl) {
  const { bytes, meta: m } = meta(gl);
  const parsed = await parseGeneralLedger(bytes);
  console.log(`General ledger ${parsed.periodStart} .. ${parsed.periodEnd}, ${parsed.accounts.size} accounts`);
  report("   committed", await commitGeneralLedger(entity.id, parsed, m), parsed.warnings);
}

const tb = flag("tb");
if (tb) {
  const asOf = flag("as-of");
  if (!asOf) {
    console.error("--tb needs --as-of <YYYY-MM-DD> (the date the balances are as at).");
    process.exit(1);
  }
  const { bytes, meta: m } = meta(tb);
  const parsed = await parseTrialBalance(bytes, "opening");
  console.log(`Trial balance as at ${asOf}, basis ${parsed.basis}, Dr ${parsed.totalDebit} Cr ${parsed.totalCredit}`);
  report("   committed", await commitTrialBalance(entity.id, parsed, asOf, m), parsed.warnings);
}

const invoices = flag("invoices");
if (invoices) {
  const { bytes, meta: m } = meta(invoices);
  const parsed = await parseInvoices(bytes);
  console.log(`Invoices ${parsed.periodStart} .. ${parsed.periodEnd}`);
  report("   committed", await commitInvoices(entity.id, parsed, m), parsed.warnings);
}

const creditNotes = flag("credit-notes");
if (creditNotes) {
  const { bytes, meta: m } = meta(creditNotes);
  const parsed = await parseCreditNotes(bytes);
  console.log(`Credit notes ${parsed.periodStart} .. ${parsed.periodEnd}, total ${parsed.totalCredited}`);
  report("   committed", await commitCreditNotes(entity.id, parsed, m), parsed.warnings);
}

const payments = flag("payments");
if (payments) {
  const { bytes, meta: m } = meta(payments);
  const parsed = await parsePayments(bytes);
  console.log(`Payments ${parsed.periodStart} .. ${parsed.periodEnd}`);
  report("   committed", await commitPayments(entity.id, parsed, m), parsed.warnings);
}

const retainers = flag("retainers");
if (retainers) {
  const { bytes, meta: m } = meta(retainers);
  const parsed = await parseRetainers(bytes);
  console.log(
    `Retainers ${parsed.periodStart} .. ${parsed.periodEnd}, ${parsed.detected.layout} layout, ` +
      `total ${parsed.rows.reduce((s, r) => s + r.amountBase, 0).toFixed(2)}`,
  );
  report("   committed", await commitRetainers(entity.id, parsed, m), parsed.warnings);
}

const ar = flag("ar");
if (ar) {
  const { bytes, meta: m } = meta(ar);
  const parsed = await parseArAging(bytes, flag("as-of-ar"));
  console.log(`AR aging as at ${parsed.asOf}, outstanding ${parsed.totalOutstanding}`);
  report("   committed", await commitArAging(entity.id, parsed, m), parsed.warnings);
}

await pool.end();

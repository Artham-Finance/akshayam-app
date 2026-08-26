/**
 * Parses a real Zoho general ledger and reports what came out, without
 * touching the database. Use this to check a new export before committing it.
 *
 *   npx tsx scripts/inspect-gl.mts "<path to xlsx>"
 */
import { readFileSync } from "node:fs";
import { parseGeneralLedger } from "../src/lib/parse/gl";
import { suggestMapping } from "../src/lib/mapping";

const path = process.argv[2];
if (!path) {
  console.error('usage: npx tsx scripts/inspect-gl.mts "<file.xlsx>"');
  process.exit(1);
}

const inr = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

const parsed = await parseGeneralLedger(readFileSync(path));

console.log("\n=== Detected ===");
console.log(`  sheet          ${parsed.detected.sheetName}`);
console.log(`  header row     ${parsed.detected.headerRow}`);
console.log(`  layout         ${parsed.detected.layout}`);
console.log(`  date order     ${parsed.detected.dateOrder}`);
console.log(`  vertical col   ${parsed.detected.verticalColumn ?? "(none)"}`);
console.log(`  acct type col  ${parsed.detected.accountTypeColumn ?? "(none)"}`);

console.log("\n=== Volume ===");
console.log(`  rows           ${inr(parsed.rows.length)}`);
console.log(`  accounts       ${parsed.accounts.size}`);
console.log(`  period         ${parsed.periodStart} .. ${parsed.periodEnd}`);

const debit = parsed.rows.reduce((s, r) => s + r.debit, 0);
const credit = parsed.rows.reduce((s, r) => s + r.credit, 0);
console.log(`  total debit    ${inr(debit)}`);
console.log(`  total credit   ${inr(credit)}`);
console.log(`  difference     ${inr(debit - credit)}`);

console.log("\n=== Verticals ===");
const byVertical = new Map<string, number>();
for (const row of parsed.rows) {
  const key = row.vertical ?? "(untagged)";
  byVertical.set(key, (byVertical.get(key) ?? 0) + 1);
}
for (const [name, count] of [...byVertical].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(6)}  ${name}`);
}

console.log("\n=== Months present ===");
const byMonth = new Map<string, number>();
for (const row of parsed.rows) {
  const key = row.date.slice(0, 7);
  byMonth.set(key, (byMonth.get(key) ?? 0) + 1);
}
for (const [month, count] of [...byMonth].sort()) {
  console.log(`  ${month}  ${String(count).padStart(6)} rows`);
}

console.log("\n=== Account classification ===");
const netByAccount = new Map<string, number>();
for (const row of parsed.rows) {
  netByAccount.set(row.accountName, (netByAccount.get(row.accountName) ?? 0) + row.debit - row.credit);
}

const groups = new Map<string, { count: number; accounts: string[] }>();
const unclassified: string[] = [];
for (const [name, zohoType] of parsed.accounts) {
  const guess = suggestMapping(name, zohoType);
  const key = `${guess.statement}/${guess.groupCode ?? "-"}`;
  if (!groups.has(key)) groups.set(key, { count: 0, accounts: [] });
  const entry = groups.get(key)!;
  entry.count++;
  entry.accounts.push(name);
  if (guess.statement === "none" || !guess.groupCode) unclassified.push(`${name}  [type=${zohoType}]`);
}

for (const [key, entry] of [...groups].sort()) {
  console.log(`  ${key.padEnd(22)} ${String(entry.count).padStart(3)} accounts`);
}

if (unclassified.length) {
  console.log(`\n=== Would land nowhere (${unclassified.length}) ===`);
  for (const name of unclassified.slice(0, 40)) console.log(`  ${name}`);
  if (unclassified.length > 40) console.log(`  ... and ${unclassified.length - 40} more`);
} else {
  console.log("\n  Every account maps to a reporting line.");
}

console.log("\n=== Zoho account types seen ===");
const types = new Map<string, number>();
for (const [, t] of parsed.accounts) types.set(t ?? "(null)", (types.get(t ?? "(null)") ?? 0) + 1);
for (const [t, n] of [...types].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(3)}  ${t}`);
}

if (parsed.warnings.length) {
  console.log("\n=== Warnings ===");
  for (const w of parsed.warnings) console.log(`  - ${w}`);
}
console.log();

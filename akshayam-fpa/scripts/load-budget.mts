/**
 * Load the planning workbook from the terminal.
 *
 *   node --env-file-if-exists=.env.local scripts/load-budget.mts <workbook.xlsx> [--fy 2026]
 *
 * The same thing the Budget tile on the upload page does, for a machine with
 * no browser open. Both go through src/lib/parse/budget.ts and
 * commitBudget(), so a budget loaded here and one loaded through the app can
 * never come out different - which was the point of moving the logic out of
 * this file.
 *
 * Loads the budgeted P&L and the Other-expenses breakdown for every sheet the
 * workbook carries: the group and both companies.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { pool } from "../src/lib/db";
import { commitBudget } from "../src/lib/ingest";
import { parseBudgetWorkbook } from "../src/lib/parse/budget";

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/load-budget.mts <workbook.xlsx> [--fy 2026]");
  process.exit(1);
}
const fyArg = process.argv.indexOf("--fy");
const fy = fyArg >= 0 ? Number(process.argv[fyArg + 1]) : undefined;

const bytes = readFileSync(file);
const parsed = await parseBudgetWorkbook(bytes, fy);

const result = await commitBudget(parsed, {
  originalName: basename(file),
  byteSize: bytes.byteLength,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  storedPath: null,
});

console.log(
  `\nFY ${parsed.fyStartYear}-${String(parsed.fyStartYear + 1).slice(2)} · ` +
    `${parsed.detected.months} month(s) · sheets: ${parsed.detected.sheets.join(", ")}\n`,
);
for (const entry of result.loaded) {
  console.log(
    `   ${entry.name.padEnd(46)}${String(entry.pnlRows).padStart(4)} P&L  ` +
      `${String(entry.expenseRows).padStart(4)} expense line(s)`,
  );
}
for (const warning of parsed.warnings) console.log(`   ! ${warning}`);
if (result.needsReview.length > 0) {
  console.log(`\n   ! not recognised, and therefore not loaded:`);
  for (const label of [...new Set(result.needsReview)]) console.log(`       ${label}`);
}
console.log(`\n${result.rowsInserted} row(s) written.`);

await pool.end();

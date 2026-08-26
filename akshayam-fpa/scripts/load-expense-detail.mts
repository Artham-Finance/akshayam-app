/**
 * Load the breakdown behind "Other expenses" from the planning workbook.
 *
 *   node --env-file-if-exists=.env.local scripts/load-expense-detail.mts <workbook.xlsx> [--fy 2026]
 *
 * The monthly sheets carry the same overheads twice: once as a statement, and
 * again lower down broken out line by line for whoever built the budget. The
 * statement block gives the heads and the figure each one totals; the detail
 * block gives the sub-lines under the two heads that have them. Neither on its
 * own is the breakdown, so both are read and joined.
 *
 * Two heads never reach this table:
 *
 *   Office Expenses      establishment cost, not an overhead - the founder
 *                        reads Other expenses as everything that is neither
 *                        establishment nor team
 *   Consultancy Charges  team cost, for the same reason
 *
 * What is left sums to the 'overheads' figure budget_pnl already holds for the
 * month, and the load checks that it does rather than trusting it.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pool } from "../src/lib/db";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx") as typeof import("xlsx");

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/load-expense-detail.mts <workbook.xlsx> [--fy 2026]");
  process.exit(1);
}
const fyArg = process.argv.indexOf("--fy");
const FY = fyArg >= 0 ? Number(process.argv[fyArg + 1]) : 2026;

/**
 * Heads that belong to another line of the statement, not to Other expenses.
 *
 * The GIFT branch rent sits in the consolidated sheet's overhead block but is
 * loaded as establishment cost, the same as the office it is - leaving it here
 * would put 91,000 a month of rent inside the line the founder reads as
 * everything that is *not* rent.
 */
const NOT_AN_OVERHEAD =
  /^(office expenses|consultancy charges|gift - rent and other expenses)$/i;

/** Where each company's monthly budget lives. */
const SHEETS: { slug: string; sheet: string }[] = [
  { slug: "group", sheet: "CONSOLIDATED - MONTHLY" },
  { slug: "rbjv", sheet: "3 - RBJV Monthly" },
];

const workbook = XLSX.read(readFileSync(file), { cellDates: true });

const monthColumns = (header: unknown[]): { index: number; month: string }[] => {
  const abbr = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
  const out: { index: number; month: string }[] = [];
  header.forEach((cell, i) => {
    const m = String(cell ?? "").trim().toLowerCase().match(/^([a-z]{3})-(\d{2})$/);
    if (!m) return;
    const month = abbr.indexOf(m[1]);
    if (month < 0) return;
    out.push({ index: i, month: `20${m[2]}-${String(month + 1).padStart(2, "0")}-01` });
  });
  return out;
};

const amounts = (row: unknown[], columns: { index: number; month: string }[]) => {
  const out = new Map<string, number>();
  for (const col of columns) {
    const value = Number(row[col.index]);
    out.set(col.month, Number.isFinite(value) ? value : 0);
  }
  return out;
};

interface Line {
  head: string;
  label: string;
  sortOrder: number;
  byMonth: Map<string, number>;
}

/**
 * Sub-lines the firm reads as heads in their own right.
 *
 * The workbook files technology, training and the two filing costs under Other
 * Expenses, which leaves the line the founder watches carrying four things
 * that have nothing to do with each other and are each worth a number of their
 * own. They are lifted out and shown between Communication and what is left of
 * Other Expenses.
 *
 * Two sub-lines can share a head: domain renewal is technology spend and is
 * read with the rest of it rather than beside it.
 */
const PROMOTE: { label: string; head: string }[] = [
  { label: "Computer & Software", head: "Computer & Software" },
  { label: "Domain Renewal", head: "Computer & Software" },
  { label: "Professional Dev", head: "Professional Development" },
  { label: "DSC Expenses", head: "DSC Expenses" },
  { label: "MCA Expenses", head: "MCA Expenses" },
];

/** The head the promoted ones are placed after. */
const PROMOTE_AFTER = /^communication/i;

/**
 * Lift the promoted sub-lines out of their head and give each its own.
 *
 * A promoted head with more than one source line becomes a single figure: the
 * firm reads "Computer & Software" as one number, and splitting it back into
 * software and domain renewal would put the detail back that lifting it out
 * was meant to remove.
 */
function promote(lines: Line[]): void {
  const anchor = lines.filter((l) => PROMOTE_AFTER.test(l.head)).pop();
  const base = anchor ? anchor.sortOrder : 0;

  const merged = new Map<string, Line>();
  for (const rule of PROMOTE) {
    const found = lines.filter((l) => l.label === rule.label);
    if (found.length === 0) continue;
    const target =
      merged.get(rule.head) ??
      { head: rule.head, label: rule.head, sortOrder: 0, byMonth: new Map<string, number>() };
    for (const line of found) {
      for (const [month, amount] of line.byMonth) {
        target.byMonth.set(month, (target.byMonth.get(month) ?? 0) + amount);
      }
      lines.splice(lines.indexOf(line), 1);
    }
    merged.set(rule.head, target);
  }

  // Keep the order the rules are written in, just after the anchor, and leave
  // room between them so a later line can still be slotted in.
  let offset = 1;
  const seen = new Set<string>();
  for (const rule of PROMOTE) {
    if (seen.has(rule.head)) continue;
    seen.add(rule.head);
    const line = merged.get(rule.head);
    if (!line) continue;
    line.sortOrder = base + offset;
    offset += 1;
    lines.push(line);
  }

  lines.sort((a, b) => a.sortOrder - b.sortOrder);
}

let wrote = 0;

for (const spec of SHEETS) {
  const sheet = workbook.Sheets[spec.sheet];
  if (!sheet) {
    console.error(`  ! sheet "${spec.sheet}" not found`);
    continue;
  }
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });

  const headerRow = rows.findIndex((r) => monthColumns(r ?? []).length >= 12);
  if (headerRow < 0) {
    console.error(`  ! "${spec.sheet}" has no row of twelve month columns`);
    continue;
  }
  const columns = monthColumns(rows[headerRow]);

  const entity = (
    await pool.query<{ id: number; name: string }>(
      "select id, name from entities where slug = $1",
      [spec.slug],
    )
  ).rows[0];
  if (!entity) {
    console.error(`  ! no entity "${spec.slug}"`);
    continue;
  }

  // ---- pass 1: the statement block, for the heads and their totals ----
  const detailStart = rows.findIndex((r) => /overhead expenses/i.test(String(r?.[0] ?? "")));
  const heads: { label: string; byMonth: Map<string, number> }[] = [];

  for (const row of rows.slice(headerRow + 1, detailStart < 0 ? undefined : detailStart)) {
    if (!row) continue;
    const raw = String(row[0] ?? "");
    const label = raw.trim();
    if (!label) continue;
    // Indented rows are headings or the vertical breakdown of team cost, and
    // the totals below are struck from the lines rather than read.
    if (/^\s{2}/.test(raw)) continue;
    if (/^(sub-?total|total|ebitda|profit|net profit|drawings|tax expense|depreciation|borrowing cost|rb$|jv$|car emi|monthly withdrawals|vpp$)/i.test(label)) continue;
    if (/^(professional fee income|acc share|jayanth|retainership fees|dsc income)/i.test(label)) continue;
    if (NOT_AN_OVERHEAD.test(label)) continue;
    heads.push({ label, byMonth: amounts(row, columns) });
  }

  // ---- pass 2: the detail block, for the sub-lines under each head ----
  const subLines = new Map<string, Line[]>();
  let currentHead: string | null = null;

  if (detailStart >= 0) {
    for (const row of rows.slice(detailStart + 1)) {
      if (!row) continue;
      const raw = String(row[0] ?? "");
      const label = raw.trim();
      if (!label) continue;
      if (/^(sub-?total|total)/i.test(label)) break;

      const isSub = /^\s*[—–-]/.test(raw.replace(/^\s{2}/, "")) || /^\s{2}\s*[—–-]/.test(raw);
      if (isSub) {
        if (!currentHead) continue;
        const clean = label.replace(/^[—–-]\s*/, "").trim();
        const list = subLines.get(currentHead) ?? [];
        list.push({
          head: currentHead,
          label: clean,
          sortOrder: list.length,
          byMonth: amounts(row, columns),
        });
        subLines.set(currentHead, list);
      } else {
        currentHead = NOT_AN_OVERHEAD.test(label) ? null : label;
      }
    }
  }

  // ---- join: a head with sub-lines contributes them, otherwise itself ----
  const lines: Line[] = [];
  heads.forEach((head, headIndex) => {
    const subs = subLines.get(head.label);
    if (subs && subs.length > 0) {
      // A head's own figure can exceed its sub-lines where the workbook keeps
      // part of it unbroken. That remainder is a real cost and is kept as a
      // line of its own rather than being dropped or silently rounded away.
      const remainder = new Map<string, number>();
      let anyRemainder = false;
      for (const col of columns) {
        const total = head.byMonth.get(col.month) ?? 0;
        const summed = subs.reduce((s, x) => s + (x.byMonth.get(col.month) ?? 0), 0);
        const diff = Math.round((total - summed) * 100) / 100;
        remainder.set(col.month, diff);
        if (Math.abs(diff) > 0.5) anyRemainder = true;
      }
      subs.forEach((s, i) => lines.push({ ...s, sortOrder: headIndex * 100 + i }));
      if (anyRemainder) {
        lines.push({
          head: head.label,
          label: `${head.label} — not broken out`,
          sortOrder: headIndex * 100 + 99,
          byMonth: remainder,
        });
      }
    } else {
      lines.push({
        head: head.label,
        label: head.label,
        sortOrder: headIndex * 100,
        byMonth: head.byMonth,
      });
    }
  });

  // ---- promote the sub-lines the firm reads as heads in their own right ----
  promote(lines);

  await pool.query(
    "delete from expense_budget_lines where entity_id = $1 and fy_start_year = $2",
    [entity.id, FY],
  );

  for (const line of lines) {
    for (const [month, amount] of line.byMonth) {
      await pool.query(
        `insert into expense_budget_lines
           (entity_id, fy_start_year, head, label, month, amount, sort_order)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [entity.id, FY, line.head, line.label, month, Math.round(amount * 100) / 100, line.sortOrder],
      );
      wrote += 1;
    }
  }

  // ---- check the detail against the total the statement already carries ----
  const check = await pool.query<{ month: string; detail: string; statement: string }>(
    `select to_char(d.month, 'Mon-YY') as month,
            round(d.total)::text as detail,
            round(coalesce(b.amount, 0))::text as statement
       from (select month, sum(amount) as total
               from expense_budget_lines
              where entity_id = $1 and fy_start_year = $2
              group by month) d
       left join budget_pnl b
              on b.entity_id = $1 and b.fy_start_year = $2
             and b.month = d.month and b.group_code = 'overheads'
      where abs(d.total - coalesce(b.amount, 0)) > 0.5
      order by d.month`,
    [entity.id, FY],
  );

  console.log(`\n${entity.name} — ${spec.sheet}`);
  console.log(`   ${lines.length} line(s) across ${columns.length} month(s)`);
  const byHead = new Map<string, number>();
  for (const l of lines) {
    byHead.set(l.head, (byHead.get(l.head) ?? 0) + [...l.byMonth.values()].reduce((a, b) => a + b, 0));
  }
  for (const [head, total] of byHead) {
    console.log(`   ${head.padEnd(28)}${Math.round(total).toLocaleString("en-IN").padStart(14)}`);
  }
  if (check.rows.length > 0) {
    console.log(`   ! the breakdown does not agree with budget_pnl 'overheads':`);
    for (const r of check.rows) {
      console.log(`       ${r.month}  detail ${r.detail}  vs statement ${r.statement}`);
    }
  } else {
    console.log(`   ✓ every month agrees with the 'overheads' line in budget_pnl`);
  }
}

console.log(`\n${wrote} expense line row(s) written for FY ${FY}-${String(FY + 1).slice(2)}.`);
await pool.end();

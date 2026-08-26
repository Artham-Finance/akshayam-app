/**
 * Load the budgeted P&L from the planning workbook.
 *
 *   node --env-file-if-exists=.env.local scripts/load-budget.mts <workbook.xlsx> [--fy 2026]
 *
 * The three budget sheets are hand-built management schedules, not exports:
 * the rows are prose labels, the subtotals are formulas, and the layout is
 * chosen for reading. A tolerant parser would be guessing. Each line is
 * therefore matched by name to the reporting line it belongs on, and anything
 * unrecognised is reported rather than absorbed - if a row moves or is renamed
 * next year the load says so instead of silently dropping a cost.
 *
 * Subtotals in the sheet (EBITDA, PBT, PAT, total opex) are deliberately NOT
 * loaded. They are recomputed from the lines, the same way the actual is, so
 * the two columns of every comparison are the same definition.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pool } from "../src/lib/db";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx") as typeof import("xlsx");

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/load-budget.mts <workbook.xlsx> [--fy 2026]");
  process.exit(1);
}
const fyArg = process.argv.indexOf("--fy");
const FY = fyArg >= 0 ? Number(process.argv[fyArg + 1]) : 2026;

/** Which reporting line each budget row belongs on. */
type Line =
  | "revenue"
  | "direct_cost"
  | "establishment_cost"
  | "overheads"
  | "depreciation"
  | "finance_cost"
  | "tax"
  | "partner_drawings";

interface SheetSpec {
  slug: string;
  sheet: string;
  /** row label -> reporting line. Labels are matched trimmed and case-folded. */
  lines: Record<string, Line>;
  /** labels to skip in silence: subtotals, headings, breakdowns of a line above */
  ignore: RegExp[];
  /**
   * Where the statement ends and the supporting detail begins.
   *
   * Each sheet repeats its overheads further down, broken out line by line for
   * whoever built the budget. Read straight through, every one of those costs
   * lands a second time - the first load put establishment cost at three times
   * its real figure. The schedule above the break is the statement; everything
   * below it is working.
   */
  stopAt: RegExp;
}

/**
 * Revenue is taken from the single "TOTAL REVENUE" row rather than its
 * components, because the components net (ACC share is negative) and the total
 * is the figure the rest of the workbook agrees with.
 */
const COMMON_IGNORE = [
  /^\s*$/,
  /^ {2}/, // indented rows are headings or breakdowns of the line above
  /^(sub-?total|total)/i,
  /^ebitda/i,
  /^profit before tax/i,
  /^net profit after tax/i,
  /^drawings$/i,
  /^car emi$/i,
  /^monthly withdrawals$/i,
  /^vpp base calculation/i,
  /^budgeted revenue with acc/i,
  /^acc transfer price$/i,
  /^professional fee income/i,
  /^acc share$/i,
  /^jayanth/i,
  /^retainership fees$/i,
  /^dsc income$/i,
  /^name \/ role$/i,
];

const SHEETS: SheetSpec[] = [
  {
    slug: "group",
    sheet: "CONSOLIDATED - MONTHLY",
    lines: {
      "total revenue": "revenue",
      vpp: "direct_cost",
      // Consultancy is bought-in delivery capacity, so it belongs with the
      // team, not with the running costs of the office. The founder reads
      // "Other expenses" as everything that is neither establishment nor team.
      "consultancy charges": "direct_cost",
      "accounting support": "overheads",
      "staff welfare": "overheads",
      "office expenses": "establishment_cost",
      "travelling & conveyance": "overheads",
      "communication expenses": "overheads",
      "other expenses": "overheads",
      "referral fee": "overheads",
      "gift - rent and other expenses": "establishment_cost",
      donation: "overheads",
      "borrowing cost": "finance_cost",
      depreciation: "depreciation",
      "tax expense (@35%)": "tax",
      rb: "partner_drawings",
      jv: "partner_drawings",
    },
    ignore: COMMON_IGNORE,
    stopAt: /overhead expenses/i,
  },
  {
    slug: "rbjv",
    sheet: "3 - RBJV Monthly",
    lines: {
      "total revenue": "revenue",
      vpp: "direct_cost",
      // Consultancy is bought-in delivery capacity, so it belongs with the
      // team, not with the running costs of the office. The founder reads
      // "Other expenses" as everything that is neither establishment nor team.
      "consultancy charges": "direct_cost",
      "accounting support": "overheads",
      "staff welfare": "overheads",
      "office expenses": "establishment_cost",
      "travelling & conveyance": "overheads",
      "communication expenses": "overheads",
      "other expenses": "overheads",
      "referral fee": "overheads",
      donation: "overheads",
      "borrowing cost": "finance_cost",
      depreciation: "depreciation",
      "tax expense (@35%)": "tax",
      rb: "partner_drawings",
      jv: "partner_drawings",
    },
    ignore: COMMON_IGNORE,
    stopAt: /overhead expenses/i,
  },
  {
    slug: "akshayam",
    sheet: "4 - Akshayam Monthly",
    lines: {
      "total revenue": "revenue",
      "salaries — gift & reg vertical": "direct_cost",
      vpp: "direct_cost",
      "branch office rent — gift city": "establishment_cost",
      "flat rent & maintenance": "establishment_cost",
      "accounting support": "overheads",
      "other expenses (travel)": "overheads",
      "on revenue basis": "overheads",
      "on head count": "overheads",
      "equal distribution": "overheads",
      "tax expense (@25%)": "tax",
    },
    ignore: [...COMMON_IGNORE, /^common cost allocation$/i],
    stopAt: /salary detail/i,
  },
];

/**
 * The per-vertical professional fee rows on the two RBJV sheets are the team
 * cost of each vertical. They are matched by prefix rather than listed, because
 * the vertical names change between budget versions and the prefix does not.
 */
const PROF_FEE_PREFIX = /^\s*prof fees\s*—/i;

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

let totalRows = 0;
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
    await pool.query<{ id: number; name: string }>("select id, name from entities where slug = $1", [
      spec.slug,
    ])
  ).rows[0];
  if (!entity) {
    console.error(`  ! no entity "${spec.slug}"`);
    continue;
  }

  const byMonthLine = new Map<string, number>();
  const unmatched: string[] = [];

  for (const row of rows.slice(headerRow + 1)) {
    if (!row) continue;
    const rawLabel = String(row[0] ?? "");
    const label = rawLabel.trim().toLowerCase();
    if (!label) continue;
    if (spec.stopAt.test(rawLabel)) break;

    let line: Line | null = null;
    if (PROF_FEE_PREFIX.test(rawLabel)) line = "direct_cost";
    else if (spec.lines[label]) line = spec.lines[label];
    else if (spec.ignore.some((re) => re.test(rawLabel))) continue;
    else {
      unmatched.push(rawLabel.trim());
      continue;
    }

    for (const col of columns) {
      const value = Number(row[col.index]);
      if (!Number.isFinite(value) || value === 0) continue;
      const key = `${col.month}|${line}`;
      byMonthLine.set(key, (byMonthLine.get(key) ?? 0) + value);
    }
  }

  await pool.query("delete from budget_pnl where entity_id = $1 and fy_start_year = $2", [
    entity.id,
    FY,
  ]);
  for (const [key, amount] of byMonthLine) {
    const [month, groupCode] = key.split("|");
    await pool.query(
      `insert into budget_pnl (entity_id, fy_start_year, month, group_code, amount)
       values ($1, $2, $3, $4, $5)`,
      [entity.id, FY, month, groupCode, Math.round(amount * 100) / 100],
    );
  }

  const annual = [...byMonthLine.entries()].reduce<Record<string, number>>((acc, [key, v]) => {
    const line = key.split("|")[1];
    acc[line] = (acc[line] ?? 0) + v;
    return acc;
  }, {});
  console.log(`\n${entity.name} — ${spec.sheet}`);
  for (const [line, value] of Object.entries(annual).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${line.padEnd(20)}${Math.round(value).toLocaleString("en-IN").padStart(14)}`);
  }
  if (unmatched.length) {
    console.log(`   ! not recognised, and therefore not loaded:`);
    for (const label of [...new Set(unmatched)]) console.log(`       ${label}`);
  }
  totalRows += byMonthLine.size;
}

console.log(`\n${totalRows} budget row(s) written for FY ${FY}-${String(FY + 1).slice(2)}.`);
await pool.end();

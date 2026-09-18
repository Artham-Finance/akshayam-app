/**
 * The planning workbook: the budgeted P&L and the Other-expenses breakdown.
 *
 * One file feeds two tables and three entities. The sheets are hand-built
 * management schedules, not exports - the rows are prose labels, the subtotals
 * are formulas, and the layout is chosen for reading. A tolerant parser would
 * be guessing, so each line is matched by name to the reporting line it
 * belongs on and anything unrecognised is reported rather than absorbed. If a
 * row moves or is renamed next year the load says so instead of silently
 * dropping a cost.
 *
 * Subtotals in the sheet (EBITDA, PBT, PAT, total opex) are deliberately not
 * read. They are recomputed from the lines, the same way the actual is, so the
 * two columns of every comparison are the same definition.
 *
 * This module is shared by the upload page and by scripts/load-budget.mts, so
 * a budget loaded through the browser and one loaded from the terminal can
 * never come out different.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx") as typeof import("xlsx");

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


/* ---------- the Other-expenses breakdown ---------- */

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

interface ExpenseLine {
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
function promote(lines: ExpenseLine[]): void {
  const anchor = lines.filter((l) => PROMOTE_AFTER.test(l.head)).pop();
  const base = anchor ? anchor.sortOrder : 0;

  const merged = new Map<string, ExpenseLine>();
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

/**
 * A third telling of two Other-expenses heads, deeper than the detail block
 * itself: on the RBJV-shaped sheets, "Computer & Software" and "Dues and
 * subscription" are each broken out again, further down, into what the money
 * actually went on. Titles are matched by exact name, the same way the rest
 * of this module reads a hand-built sheet - a schedule that has moved or been
 * renamed is left unread rather than guessed at.
 *
 * This is the same split the partners have been keeping by hand in
 * db/migrations/052_rbjv_computer_expense_split.sql and
 * 053_rbjv_dues_and_subscription_group.sql, re-applied after every budget
 * re-upload because a re-upload wipes it. Reading it here means it survives
 * one.
 */
const VENDOR_BLOCK_TITLES = ["Software subscription", "Computer maintenance", "Dues and subscription"];

/** The head a block's own vendor lines land under, absent an override below. */
const VENDOR_BLOCK_HEAD: Record<string, string> = {
  "Software subscription": "Computer - subscription",
  "Computer maintenance": "Computer maintenance charges",
  "Dues and subscription": "Dues and subscription",
};

/**
 * Vendor lines the partners read differently than the block they print
 * under: Domain Renewal is technology spend, read with the rest of the
 * subscriptions rather than beside the one-off maintenance bills it happens
 * to sit next to on the sheet; "Dues & Subscriptions" is the one line the
 * whole ICSI membership budget sits on, and is named for what it is.
 */
const VENDOR_OVERRIDE: Record<string, { head?: string; label?: string }> = {
  "Domain Renewal": { head: "Computer - subscription" },
  "Dues & Subscriptions": { label: "ICSI membership" },
};

/**
 * Read the vendor-level rows beneath a detail block's own break.
 *
 * Each block opens with a bold title (one of VENDOR_BLOCK_TITLES) and is
 * followed by its vendor lines, unindented, until a blank row, a sub-total, or
 * the next block title closes it. A row before any title, or once a block has
 * closed, belongs to neither and is skipped.
 */
function vendorRowsOf(
  rows: unknown[][],
  fromIndex: number,
  columns: { index: number; month: string }[],
): { block: string; label: string; byMonth: Map<string, number> }[] {
  const out: { block: string; label: string; byMonth: Map<string, number> }[] = [];
  let block: string | null = null;

  for (const row of rows.slice(fromIndex)) {
    if (!row) {
      block = null;
      continue;
    }
    const raw = String(row[0] ?? "");
    const label = raw.trim().replace(/^[—–-]\s*/, "").trim();
    if (!label) {
      block = null;
      continue;
    }
    if (/^(sub-?total|total)/i.test(label)) {
      block = null;
      continue;
    }

    const title = VENDOR_BLOCK_TITLES.find((t) => t.toLowerCase() === label.toLowerCase());
    if (title) {
      block = title;
      continue;
    }

    if (!block) continue;
    out.push({ block, label, byMonth: amountsOf(row, columns) });
  }

  return out;
}

/**
 * Replace "Computer & Software" and the "Dues and subscription" label with
 * the vendor lines the sheet's own third schedule gives them, keeping the
 * heads' own totals as a "not broken out" remainder wherever the vendor
 * lines fall short of it.
 */
function applyVendorSplit(
  lines: ExpenseLine[],
  vendorRows: { block: string; label: string; byMonth: Map<string, number> }[],
  columns: { index: number; month: string }[],
): void {
  const expand = (
    original: ExpenseLine,
    rows: { block: string; label: string; byMonth: Map<string, number> }[],
    baseSort: number,
  ): ExpenseLine[] => {
    const out = rows.map((r, i) => {
      const override = VENDOR_OVERRIDE[r.label];
      return {
        head: override?.head ?? VENDOR_BLOCK_HEAD[r.block],
        label: override?.label ?? r.label,
        sortOrder: baseSort + i,
        byMonth: r.byMonth,
      };
    });
    const remainder = new Map<string, number>();
    let anyRemainder = false;
    for (const col of columns) {
      const total = original.byMonth.get(col.month) ?? 0;
      const summed = out.reduce((s, r) => s + (r.byMonth.get(col.month) ?? 0), 0);
      const diff = Math.round((total - summed) * 100) / 100;
      remainder.set(col.month, diff);
      if (Math.abs(diff) > 0.5) anyRemainder = true;
    }
    if (anyRemainder) {
      out.push({
        head: original.head,
        label: `${original.label} — not broken out`,
        sortOrder: baseSort + out.length,
        byMonth: remainder,
      });
    }
    return out;
  };

  const computerIdx = lines.findIndex((l) => l.head === "Computer & Software");
  let cursor = computerIdx >= 0 ? lines[computerIdx].sortOrder : 0;

  if (computerIdx >= 0) {
    const forComputer = vendorRows.filter(
      (r) => r.block === "Software subscription" || r.block === "Computer maintenance",
    );
    if (forComputer.length > 0) {
      const replacement = expand(lines[computerIdx], forComputer, cursor);
      lines.splice(computerIdx, 1, ...replacement);
      cursor += replacement.length;
    }
  }

  const duesIdx = lines.findIndex((l) => l.head === "Other Expenses" && l.label === "Dues and subscription");
  if (duesIdx >= 0) {
    const forDues = vendorRows.filter((r) => r.block === "Dues and subscription");
    if (forDues.length > 0) {
      const replacement = expand(lines[duesIdx], forDues, cursor + 1);
      lines.splice(duesIdx, 1, ...replacement);
    }
  }

  lines.sort((a, b) => a.sortOrder - b.sortOrder);
}


/* ============================================================
   The parse
   ============================================================ */

export interface BudgetPnlRow {
  month: string;
  groupCode: Line;
  amount: number;
}

export interface BudgetExpenseRow {
  head: string;
  label: string;
  month: string;
  amount: number;
  sortOrder: number;
}

export interface BudgetEntityResult {
  slug: string;
  sheet: string;
  pnl: BudgetPnlRow[];
  expenses: BudgetExpenseRow[];
  /** row labels the sheet carries that no rule claims, so nothing is lost quietly */
  unmatched: string[];
}

export interface BudgetParseResult {
  fyStartYear: number;
  entities: BudgetEntityResult[];
  warnings: string[];
  detected: { sheets: string[]; months: number };
}

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

const amountsOf = (row: unknown[], columns: { index: number; month: string }[]) => {
  const out = new Map<string, number>();
  for (const col of columns) {
    const value = Number(row[col.index]);
    out.set(col.month, Number.isFinite(value) ? value : 0);
  }
  return out;
};

/**
 * Read the whole workbook.
 *
 * The financial year is taken from the month columns rather than assumed: the
 * sheet says which year it budgets, and a mismatch between the file and a flag
 * is the kind of error nobody notices until the variances look wrong.
 */
export async function parseBudgetWorkbook(
  input: Buffer | ArrayBuffer,
  fyStartYear?: number,
): Promise<BudgetParseResult> {
  const buffer = input instanceof Buffer ? input : Buffer.from(new Uint8Array(input));
  const workbook = XLSX.read(buffer, { cellDates: true });

  const entities: BudgetEntityResult[] = [];
  const warnings: string[] = [];
  const sheetsRead: string[] = [];
  let fy = fyStartYear ?? null;
  let monthCount = 0;

  for (const spec of SHEETS) {
    const sheet = workbook.Sheets[spec.sheet];
    if (!sheet) {
      warnings.push(
        `Sheet "${spec.sheet}" is not in this workbook, so ${spec.slug} was not loaded.`,
      );
      continue;
    }
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });

    const headerRow = rows.findIndex((r) => monthColumns(r ?? []).length >= 12);
    if (headerRow < 0) {
      warnings.push(`Sheet "${spec.sheet}" has no row of twelve month columns, so it was skipped.`);
      continue;
    }
    const columns = monthColumns(rows[headerRow]);
    sheetsRead.push(spec.sheet);
    monthCount = Math.max(monthCount, columns.length);

    // April starts the Indian financial year, so the year of the first April
    // column is the year the budget belongs to.
    if (fy === null) {
      const april = columns.find((c) => c.month.slice(5, 7) === "04");
      fy = Number((april ?? columns[0]).month.slice(0, 4));
    }

    // ---- the statement: one figure per reporting line per month ----
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

    const pnl: BudgetPnlRow[] = [...byMonthLine].map(([key, amount]) => {
      const [month, groupCode] = key.split("|");
      return { month, groupCode: groupCode as Line, amount: Math.round(amount * 100) / 100 };
    });

    entities.push({
      slug: spec.slug,
      sheet: spec.sheet,
      pnl,
      expenses: expenseLinesOf(rows, headerRow, columns),
      unmatched: [...new Set(unmatched)],
    });
  }

  if (entities.length === 0) {
    throw new Error(
      "None of the budget sheets were found. Expected the planning workbook containing " +
        SHEETS.map((s) => s.sheet).join(", ") + ".",
    );
  }

  return {
    fyStartYear: fy ?? new Date().getFullYear(),
    entities,
    warnings,
    detected: { sheets: sheetsRead, months: monthCount },
  };
}

/**
 * The breakdown beneath Other expenses.
 *
 * Each sheet carries its overheads twice: once as a statement, and again lower
 * down broken out line by line. The statement block gives the heads and what
 * each totals; the detail block gives the sub-lines under the two heads that
 * have them. Neither on its own is the breakdown, so both are read and joined.
 */
function expenseLinesOf(
  rows: unknown[][],
  headerRow: number,
  columns: { index: number; month: string }[],
): BudgetExpenseRow[] {
  const detailStart = rows.findIndex((r) => /overhead expenses/i.test(String(r?.[0] ?? "")));

  /**
   * No overhead block, no breakdown.
   *
   * Only the two RBJV-shaped sheets carry one. The Akshayam sheet states its
   * costs as an allocation of common cost and has no overhead schedule at all,
   * so reading heads from it swept up the salary detail below and produced a
   * breakdown twenty times its own Other-expenses line. A sheet that does not
   * carry the detail simply has none.
   */
  if (detailStart < 0) return [];

  const heads: { label: string; byMonth: Map<string, number> }[] = [];

  for (const row of rows.slice(headerRow + 1, detailStart < 0 ? undefined : detailStart)) {
    if (!row) continue;
    const raw = String(row[0] ?? "");
    const label = raw.trim();
    if (!label) continue;
    if (/^\s{2}/.test(raw)) continue;
    if (
      /^(sub-?total|total|ebitda|profit|net profit|drawings|tax expense|depreciation|borrowing cost|rb$|jv$|car emi|monthly withdrawals|vpp$)/i.test(
        label,
      )
    ) {
      continue;
    }
    if (/^(professional fee income|acc share|jayanth|retainership fees|dsc income)/i.test(label)) {
      continue;
    }
    if (NOT_AN_OVERHEAD.test(label)) continue;
    heads.push({ label, byMonth: amountsOf(row, columns) });
  }

  const subLines = new Map<string, ExpenseLine[]>();
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
          byMonth: amountsOf(row, columns),
        });
        subLines.set(currentHead, list);
      } else {
        currentHead = NOT_AN_OVERHEAD.test(label) ? null : label;
      }
    }
  }

  const lines: ExpenseLine[] = [];
  heads.forEach((head, headIndex) => {
    const subs = subLines.get(head.label);
    if (subs && subs.length > 0) {
      // A head's own figure can exceed its sub-lines where the workbook keeps
      // part of it unbroken. That remainder is a real cost and is kept as a
      // line of its own rather than dropped or rounded away.
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

  promote(lines);

  // The third schedule, where the sheet carries one, lives after the second
  // block's own break - found the same way that break is found inside it.
  const secondBreak = rows.findIndex(
    (r, i) => i > detailStart && /^(sub-?total|total)/i.test(String(r?.[0] ?? "").trim()),
  );
  const vendorRows = vendorRowsOf(rows, secondBreak < 0 ? rows.length : secondBreak + 1, columns);
  if (vendorRows.length > 0) applyVendorSplit(lines, vendorRows, columns);

  const out: BudgetExpenseRow[] = [];
  for (const line of lines) {
    for (const [month, amount] of line.byMonth) {
      out.push({
        head: line.head,
        label: line.label,
        month,
        amount: Math.round(amount * 100) / 100,
        sortOrder: line.sortOrder,
      });
    }
  }
  return out;
}

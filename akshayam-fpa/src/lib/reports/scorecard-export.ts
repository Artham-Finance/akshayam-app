import type ExcelJS from "exceljs";
import { fyMonths } from "@/lib/period";
import {
  WEIGHTS,
  MGMT_APPRAISAL_DEFAULT,
  type ScorecardResult,
  type ScorecardRow,
} from "@/lib/reports/scorecard";
import { COLLECTION_BUDGET_RATIO, revisedQuarterlyTable } from "@/lib/reports/scorecard-budget";
import { createWorkbook } from "@/lib/reports/xlsx";

/**
 * The Vertical Performance Scorecard as a workbook of workings, in whole rupees.
 *
 * The screen reads in lakhs, thousands or crores; this does not - every figure
 * is the rupee amount, so it can be checked against the ledger and re-added.
 *
 * One sheet for each parameter the scorecard rates (revenue vs budget,
 * collection vs budget, net revenue contribution, net collection contribution,
 * receivables ageing, management appraisal), each showing its own figures and
 * the 0-4 rating struck from them; and "Overall rating", the main sheet, which
 * carries the ratings only - every one a link to the parameter sheet it comes
 * from - and the weighted composite. A "Budget workings" sheet traces the
 * budget columns to the revised quarterly budget.
 *
 * It is built to be audited rather than just read: achievement, shares,
 * ratings, weighted ageing days and the composite are live Excel formulas on the
 * figures beside them, using the partners' own bands and weights (see
 * scorecard-rating.ts). Cached results are written with them, so a viewer that
 * does not recalculate still shows the values.
 *
 * Every sheet lists the verticals in the same order from the same row, so the
 * links on the main sheet are one cell to one cell.
 */

const NAVY = "FF16263C";
const RULE = "FFD9DEE5";
const GREY = "FF6B7684";
const RS = "##,##,##0;(##,##,##0);\"-\"";
const RS2 = "##,##,##0.00;(##,##,##0.00);\"-\"";
const PCT = "0.0%";

/** The first vertical's row on every sheet (the header sits on the row above). */
const FIRST = 6;

const S = {
  overall: "Overall rating",
  revenue: "Revenue vs budget",
  collection: "Collection vs budget",
  revContribution: "Net revenue contribution",
  collContribution: "Net collection contribution",
  ageing: "Receivables ageing",
  mgmt: "Management appraisal",
  budget: "Budget workings",
} as const;

/** A reference to a cell on another sheet. */
const ref = (sheet: string, col: string, row: number) => `'${sheet}'!${col}${row}`;

/** Excel's own letters for a 1-based column index. */
function letter(n: number): string {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

const bandRating = (cell: string, bands: [number, number, number, number], strict: boolean) => {
  const [a, b, c, d] = bands;
  const gt = strict ? ">" : ">=";
  return `IF(${cell}="",0,IF(${cell}>=${a},4,IF(${cell}${gt}${b},3,IF(${cell}${gt}${c},2,IF(${cell}${gt}${d},1,0)))))`;
};
/** Revenue / collection against budget: 4 at 100% or more, then over 80, 60, 40%. */
const budgetRating = (cell: string) => bandRating(cell, [1, 0.8, 0.6, 0.4], true);
/** Share of the firm: 4 at 20% or more, then 15, 10, 5%. */
const contributionRating = (cell: string) => bandRating(cell, [0.2, 0.15, 0.1, 0.05], false);
const ageingRatingFormula = (cell: string) =>
  `IF(${cell}<=15,4,IF(${cell}<=45,3,IF(${cell}<=75,2,IF(${cell}<=135,1,0))))`;
const MIDS = "{15,45,75,135,272.5,365}";
const AGE_MIDS = [15, 45, 75, 135, 272.5, 365];

function ratingOf(achievement: number | null): number {
  if (achievement === null) return 0;
  if (achievement >= 1) return 4;
  if (achievement > 0.8) return 3;
  if (achievement > 0.6) return 2;
  if (achievement > 0.4) return 1;
  return 0;
}
const ageingRatingOf = (days: number) => (days <= 15 ? 4 : days <= 45 ? 3 : days <= 75 ? 2 : days <= 135 ? 1 : 0);

export interface ScorecardWorkbookInput {
  entityName: string;
  fyLabel: string;
  data: ScorecardResult;
  /** the rows to list - the whole firm, or just a team lead's own */
  shown: ScorecardRow[];
  /** true when `shown` is only part of the firm (a team lead's slice) */
  isPartial: boolean;
  fyStartYear: number;
  companySlugs: string[];
  /** " (cumulative)" or empty, for the context line */
  cumulativeNote: string;
}

type Col = { header: string; width: number; fmt?: string };
type CellIn = number | string | null | { formula: string; result?: number | string };

/** A sheet with the common five-row head, ready for rows from FIRST on. */
function parameterSheet(
  workbook: ExcelJS.Workbook,
  input: ScorecardWorkbookInput,
  name: string,
  title: string,
  notes: [string, string],
  columns: Col[],
) {
  const sheet = workbook.addWorksheet(name);
  sheet.columns = columns.map((c) => ({ width: c.width }));
  const t = sheet.addRow([title]);
  t.font = { bold: true, size: 14, color: { argb: NAVY } };
  const c = sheet.addRow([
    [input.entityName, input.fyLabel, `${input.data.window.label}${input.cumulativeNote}`].join("  ·  "),
  ]);
  c.font = { size: 10, color: { argb: GREY } };
  for (const note of notes) {
    sheet.addRow([note]).font = { size: 10, italic: true, color: { argb: GREY } };
  }
  const header = sheet.addRow(columns.map((col) => col.header));
  header.height = 40;
  header.eachCell((cell, i) => {
    cell.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    cell.alignment = { vertical: "middle", wrapText: true, horizontal: i === 1 ? "left" : "right" };
  });
  sheet.views = [{ state: "frozen", xSplit: 1, ySplit: header.number }];
  if (header.number !== FIRST - 1) throw new Error("scorecard sheet head must be five rows");
  return sheet;
}

function put(sheet: ExcelJS.Worksheet, columns: Col[], rowNo: number, values: CellIn[]) {
  const row = sheet.getRow(rowNo);
  values.forEach((value, i) => {
    const cell = row.getCell(i + 1);
    cell.value = value as ExcelJS.CellValue;
    const fmt = columns[i]?.fmt;
    if (fmt) cell.numFmt = fmt;
    cell.border = { bottom: { style: "hair", color: { argb: RULE } } };
  });
  return row;
}

function boldTotal(row: ExcelJS.Row) {
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { bold: true };
    cell.border = { top: { style: "thin", color: { argb: NAVY } } };
  });
}

export function buildScorecardWorkbook(input: ScorecardWorkbookInput): ExcelJS.Workbook {
  const { data, shown, isPartial } = input;
  const workbook = createWorkbook();
  // Recalculate on opening, so every formula reads fresh whatever a viewer cached.
  workbook.calcProperties.fullCalcOnLoad = true;
  const n = shown.length;
  const last = FIRST + n - 1;
  const totalRow = last + 1;
  const all = data.rows;
  const sum = (pick: (r: ScorecardRow) => number) => all.reduce((s, r) => s + pick(r), 0);
  const table = revisedQuarterlyTable(input.fyStartYear, input.companySlugs);

  // The main sheet is created first so it opens first; its cells are filled in
  // once the parameter sheets are laid out and their rows are known.
  const overallCols: Col[] = [
    { header: "Vertical", width: 36 },
    { header: "Revenue vs budget (0-4)", width: 14 },
    { header: "Collection vs budget (0-4)", width: 14 },
    { header: "Net revenue contribution (0-4)", width: 16 },
    { header: "Net collection contribution (0-4)", width: 16 },
    { header: "Receivables ageing (0-4)", width: 14 },
    { header: "Management appraisal (0-4)", width: 14 },
    { header: "Composite (0-4)", width: 12, fmt: "0.00" },
  ];
  const overall = parameterSheet(
    workbook,
    input,
    S.overall,
    "Vertical Performance Scorecard — overall rating",
    [
      "Ratings only, 0 (worst) to 4 (best). Each rating is linked to the sheet that works it out - click a heading to go there. " +
        "Figures behind them are in Rupees (Rs), not lakhs or thousands.",
      `Composite = ${WEIGHTS.revenue} × revenue + ${WEIGHTS.collection} × collection + ${WEIGHTS.netRevContrib} × net revenue contribution + ` +
        `${WEIGHTS.netCollContrib} × net collection contribution + ${WEIGHTS.ageing} × receivables ageing + ${WEIGHTS.mgmt} × management appraisal.`,
    ],
    overallCols,
  );
  const overallHeader = overall.getRow(FIRST - 1);
  const headerLink = (col: number, sheetName: string) => {
    const cell = overallHeader.getCell(col);
    cell.value = { text: overallCols[col - 1].header, hyperlink: `#'${sheetName}'!A1` };
    cell.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" }, underline: true };
  };
  headerLink(2, S.revenue);
  headerLink(3, S.collection);
  headerLink(4, S.revContribution);
  headerLink(5, S.collContribution);
  headerLink(6, S.ageing);
  headerLink(7, S.mgmt);

  /* ---------- revenue vs budget, and collection vs budget ---------- */
  const budgetCols = (label: string): Col[] => [
    { header: "Vertical", width: 36 },
    { header: `${label} budget (Rs)`, width: 18, fmt: RS },
    { header: `${label} actual (Rs)`, width: 18, fmt: RS },
    { header: "Achievement (actual ÷ budget)", width: 14, fmt: PCT },
    { header: "Rating (0-4)", width: 11 },
  ];
  const budgetSheet = (
    name: string,
    label: string,
    pickBudget: (r: ScorecardRow) => number,
    pickActual: (r: ScorecardRow) => number,
    pickAch: (r: ScorecardRow) => number | null,
    pickRating: (r: ScorecardRow) => number,
    budgetLinkCol: string,
  ) => {
    const cols = budgetCols(label);
    const sheet = parameterSheet(
      workbook,
      input,
      name,
      `${label} against budget`,
      [
        `Budget is the revised quarterly budget for the window (see "${S.budget}")` +
          (label === "Collection" ? `, at ${Math.round(COLLECTION_BUDGET_RATIO * 100)}% of revenue` : "") +
          `. Actual is the ledger's ${label === "Revenue" ? "Revenue from Operations, net of credit notes" : "fee receipts, excluding reimbursement recoveries"}.`,
        "Rating: 4 at 100% or more of budget, 3 over 80%, 2 over 60%, 1 over 40%, otherwise 0.",
      ],
      cols,
    );
    shown.forEach((r, i) => {
      const rowNo = FIRST + i;
      const ach = pickAch(r);
      put(sheet, cols, rowNo, [
        r.label,
        table
          ? { formula: ref(S.budget, budgetLinkCol, rowNo), result: pickBudget(r) }
          : pickBudget(r),
        pickActual(r),
        { formula: `IF(B${rowNo}>0,C${rowNo}/B${rowNo},"")`, result: ach ?? "" },
        { formula: budgetRating(`D${rowNo}`), result: pickRating(r) },
      ]);
    });
    const bud = sum(pickBudget);
    const act = sum(pickActual);
    const totalCells: CellIn[] = [
      isPartial ? "Entity as a whole (all rated verticals)" : "Entity as a whole",
      isPartial ? bud : { formula: `SUM(B${FIRST}:B${last})`, result: bud },
      isPartial ? act : { formula: `SUM(C${FIRST}:C${last})`, result: act },
      { formula: `IF(B${totalRow}>0,C${totalRow}/B${totalRow},"")`, result: bud > 0 ? act / bud : "" },
      { formula: budgetRating(`D${totalRow}`), result: ratingOf(bud > 0 ? act / bud : null) },
    ];
    boldTotal(put(sheet, cols, totalRow, totalCells));
    return sheet;
  };
  budgetSheet(
    S.revenue,
    "Revenue",
    (r) => r.revenueBudget,
    (r) => r.revenueActual,
    (r) => r.revenueAchievement,
    (r) => r.ratings.revenue,
    "R",
  );
  budgetSheet(
    S.collection,
    "Collection",
    (r) => r.collectionBudget,
    (r) => r.collectionActual,
    (r) => r.collectionAchievement,
    (r) => r.ratings.collection,
    "S",
  );

  /* ---------- net revenue contribution ---------- */
  {
    const cols: Col[] = [
      { header: "Vertical", width: 36 },
      { header: "Ledger revenue (Rs)", width: 18, fmt: RS },
      { header: "Direct cost (Rs)", width: 16, fmt: RS },
      { header: "Apportioned cost (Rs)", width: 17, fmt: RS },
      { header: "Total cost (Rs)", width: 16, fmt: RS },
      { header: "Net revenue contribution (Rs)", width: 18, fmt: RS },
      { header: "Share of firm contribution", width: 14, fmt: PCT },
      { header: "Rating (0-4)", width: 11 },
    ];
    const sheet = parameterSheet(
      workbook,
      input,
      S.revContribution,
      "Net revenue contribution",
      [
        "Net contribution = ledger revenue less the vertical's own direct cost and its head-count share of Common's and ACC/HRCM's cost " +
          "(the same figures as the P&L's cost apportionment card). Share = the vertical's contribution ÷ the firm's positive contributions.",
        "Rating: 4 at a 20% share or more, 3 from 15%, 2 from 10%, 1 from 5%, otherwise 0.",
      ],
      cols,
    );
    shown.forEach((r, i) => {
      const rowNo = FIRST + i;
      const range = `$F$${FIRST}:$F$${last}`;
      put(sheet, cols, rowNo, [
        r.label,
        r.contributionRevenue,
        r.directCost,
        r.apportionedCost,
        { formula: `C${rowNo}+D${rowNo}`, result: r.cost },
        { formula: `B${rowNo}-E${rowNo}`, result: r.revenueContribution },
        isPartial
          ? (r.revenueContributionShare ?? "")
          : {
              formula: `IF(SUMIF(${range},">0")>0,F${rowNo}/SUMIF(${range},">0"),"")`,
              result: r.revenueContributionShare ?? "",
            },
        { formula: contributionRating(`G${rowNo}`), result: r.ratings.netRevContrib },
      ]);
    });
    const lr = sum((r) => r.contributionRevenue);
    const dc = sum((r) => r.directCost);
    const ac = sum((r) => r.apportionedCost);
    boldTotal(
      put(sheet, cols, totalRow, [
        isPartial ? "Entity as a whole (all rated verticals)" : "Entity as a whole",
        isPartial ? lr : { formula: `SUM(B${FIRST}:B${last})`, result: lr },
        isPartial ? dc : { formula: `SUM(C${FIRST}:C${last})`, result: dc },
        isPartial ? ac : { formula: `SUM(D${FIRST}:D${last})`, result: ac },
        { formula: `C${totalRow}+D${totalRow}`, result: dc + ac },
        { formula: `B${totalRow}-E${totalRow}`, result: lr - dc - ac },
        null,
        null,
      ]),
    );
  }

  /* ---------- net collection contribution ---------- */
  {
    const cols: Col[] = [
      { header: "Vertical", width: 36 },
      { header: "Collection actual (Rs)", width: 18, fmt: RS },
      { header: "Total cost (Rs)", width: 16, fmt: RS },
      { header: "Net collection contribution (Rs)", width: 18, fmt: RS },
      { header: "Share of firm contribution", width: 14, fmt: PCT },
      { header: "Rating (0-4)", width: 11 },
    ];
    const sheet = parameterSheet(
      workbook,
      input,
      S.collContribution,
      "Net collection contribution",
      [
        `Net contribution = collections (from "${S.collection}") less the same total cost used for revenue contribution (from "${S.revContribution}"). ` +
          "Share = the vertical's contribution ÷ the firm's positive contributions.",
        "Rating: 4 at a 20% share or more, 3 from 15%, 2 from 10%, 1 from 5%, otherwise 0.",
      ],
      cols,
    );
    shown.forEach((r, i) => {
      const rowNo = FIRST + i;
      const range = `$D$${FIRST}:$D$${last}`;
      put(sheet, cols, rowNo, [
        r.label,
        { formula: ref(S.collection, "C", rowNo), result: r.collectionActual },
        { formula: ref(S.revContribution, "E", rowNo), result: r.cost },
        { formula: `B${rowNo}-C${rowNo}`, result: r.collectionContribution },
        isPartial
          ? (r.collectionContributionShare ?? "")
          : {
              formula: `IF(SUMIF(${range},">0")>0,D${rowNo}/SUMIF(${range},">0"),"")`,
              result: r.collectionContributionShare ?? "",
            },
        { formula: contributionRating(`E${rowNo}`), result: r.ratings.netCollContrib },
      ]);
    });
    const act = sum((r) => r.collectionActual);
    const cost = sum((r) => r.cost);
    boldTotal(
      put(sheet, cols, totalRow, [
        isPartial ? "Entity as a whole (all rated verticals)" : "Entity as a whole",
        { formula: ref(S.collection, "C", totalRow), result: act },
        { formula: ref(S.revContribution, "E", totalRow), result: cost },
        { formula: `B${totalRow}-C${totalRow}`, result: act - cost },
        null,
        null,
      ]),
    );
  }

  /* ---------- receivables ageing ---------- */
  {
    const cols: Col[] = [
      { header: "Vertical", width: 36 },
      { header: "< 30 days (Rs)", width: 14, fmt: RS },
      { header: "31-60 days (Rs)", width: 14, fmt: RS },
      { header: "61-90 days (Rs)", width: 14, fmt: RS },
      { header: "91-180 days (Rs)", width: 14, fmt: RS },
      { header: "181-365 days (Rs)", width: 14, fmt: RS },
      { header: "> 1 year (Rs)", width: 14, fmt: RS },
      { header: "Total receivable (Rs)", width: 16, fmt: RS },
      { header: "Weighted-average days outstanding", width: 14, fmt: "0.0" },
      { header: "Rating (0-4)", width: 11 },
    ];
    const sheet = parameterSheet(
      workbook,
      input,
      S.ageing,
      "Receivables ageing",
      [
        "The open receivable at the snapshot nearest the window's end, by age from the due date. Weighted days = each bucket's amount × the " +
          "mid-point of its range (15, 45, 75, 135, 272.5 and 365 days) ÷ the total.",
        "Rating: 4 at 15 days or fewer, 3 to 45, 2 to 75, 1 to 135, otherwise 0.",
      ],
      cols,
    );
    const rowFor = (r: ScorecardRow, rowNo: number) => {
      const b = r.ageingBuckets;
      const days = r.ageingDays;
      return [
        r.label,
        ...b,
        { formula: `SUM(B${rowNo}:G${rowNo})`, result: r.ageingTotal },
        days === null
          ? ""
          : { formula: `IF(H${rowNo}=0,0,SUMPRODUCT(B${rowNo}:G${rowNo},${MIDS})/H${rowNo})`, result: days },
        days === null ? "" : { formula: ageingRatingFormula(`I${rowNo}`), result: r.ratings.ageing ?? 0 },
      ] as CellIn[];
    };
    shown.forEach((r, i) => put(sheet, cols, FIRST + i, rowFor(r, FIRST + i)));
    const buckets = [0, 1, 2, 3, 4, 5].map((i) => sum((r) => r.ageingBuckets[i] ?? 0));
    const total = buckets.reduce((s, b) => s + b, 0);
    const days = total === 0 ? 0 : buckets.reduce((s, b, i) => s + b * AGE_MIDS[i], 0) / total;
    boldTotal(
      put(sheet, cols, totalRow, [
        isPartial ? "Entity as a whole (all rated verticals)" : "Entity as a whole",
        ...buckets.map((b, i) =>
          isPartial ? b : { formula: `SUM(${letter(2 + i)}${FIRST}:${letter(2 + i)}${last})`, result: b },
        ),
        { formula: `SUM(B${totalRow}:G${totalRow})`, result: total },
        { formula: `IF(H${totalRow}=0,0,SUMPRODUCT(B${totalRow}:G${totalRow},${MIDS})/H${totalRow})`, result: days },
        { formula: ageingRatingFormula(`I${totalRow}`), result: ageingRatingOf(days) },
      ] as CellIn[]),
    );
  }

  /* ---------- management appraisal ---------- */
  {
    const cols: Col[] = [
      { header: "Vertical", width: 36 },
      { header: "Rating (0-4)", width: 12 },
    ];
    const sheet = parameterSheet(
      workbook,
      input,
      S.mgmt,
      "Management appraisal",
      [
        `The partners' own assessment of the team lead. It is not struck from any figure, and is set to ${MGMT_APPRAISAL_DEFAULT} for everyone until a real appraisal is recorded.`,
        "Change a rating here and the composite on the overall sheet follows.",
      ],
      cols,
    );
    shown.forEach((r, i) => put(sheet, cols, FIRST + i, [r.label, r.ratings.mgmt]));
  }

  /* ---------- the main sheet: ratings only, each a link ---------- */
  shown.forEach((r, i) => {
    const rowNo = FIRST + i;
    put(overall, overallCols, rowNo, [
      r.label,
      { formula: ref(S.revenue, "E", rowNo), result: r.ratings.revenue },
      { formula: ref(S.collection, "E", rowNo), result: r.ratings.collection },
      { formula: ref(S.revContribution, "H", rowNo), result: r.ratings.netRevContrib },
      { formula: ref(S.collContribution, "F", rowNo), result: r.ratings.netCollContrib },
      r.ageingDays === null
        ? ""
        : { formula: ref(S.ageing, "J", rowNo), result: r.ratings.ageing ?? 0 },
      { formula: ref(S.mgmt, "B", rowNo), result: r.ratings.mgmt },
      {
        formula:
          `${WEIGHTS.revenue}*B${rowNo}+${WEIGHTS.collection}*C${rowNo}+${WEIGHTS.netRevContrib}*D${rowNo}` +
          `+${WEIGHTS.netCollContrib}*E${rowNo}+${WEIGHTS.ageing}*N(F${rowNo})+${WEIGHTS.mgmt}*G${rowNo}`,
        result: r.composite,
      },
    ]);
  });
  const revBud = sum((r) => r.revenueBudget);
  const revAct = sum((r) => r.revenueActual);
  const colBud = sum((r) => r.collectionBudget);
  const colAct = sum((r) => r.collectionActual);
  const bk = [0, 1, 2, 3, 4, 5].map((i) => sum((r) => r.ageingBuckets[i] ?? 0));
  const bt = bk.reduce((s, b) => s + b, 0);
  const wd = bt === 0 ? 0 : bk.reduce((s, b, i) => s + b * AGE_MIDS[i], 0) / bt;
  boldTotal(
    put(overall, overallCols, totalRow, [
      isPartial ? "Entity as a whole (all rated verticals)" : "Entity as a whole",
      { formula: ref(S.revenue, "E", totalRow), result: ratingOf(revBud > 0 ? revAct / revBud : null) },
      { formula: ref(S.collection, "E", totalRow), result: ratingOf(colBud > 0 ? colAct / colBud : null) },
      "—",
      "—",
      { formula: ref(S.ageing, "J", totalRow), result: ageingRatingOf(wd) },
      "—",
      "—",
    ]),
  );
  overall.getRow(totalRow + 2).getCell(1).value =
    "Entity as a whole is rated on revenue, collection and receivables ageing only; contribution shares, management appraisal and the composite are per vertical.";
  overall.getRow(totalRow + 2).font = { size: 10, italic: true, color: { argb: GREY } };
  // The ratings read as whole numbers, centred, so the sheet scans as a grid.
  for (let r = FIRST; r <= totalRow; r++) {
    for (let c = 2; c <= overallCols.length; c++) overall.getRow(r).getCell(c).alignment = { horizontal: "center" };
  }

  // The revised budget behind the budget columns, last.
  if (table) addBudgetWorkings(workbook, input, table);

  return workbook;
}

function addBudgetWorkings(
  workbook: ExcelJS.Workbook,
  input: ScorecardWorkbookInput,
  table: Record<string, [number, number, number, number]>,
) {
  const { data, shown, isPartial } = input;
  const sheet = workbook.addWorksheet(S.budget);
  const months = fyMonths(input.fyStartYear);
  const inWindow = (m: { start: string; end: string }) => m.start >= data.window.start && m.end <= data.window.end;

  sheet.columns = [
    { width: 36 },
    ...Array.from({ length: 4 }, () => ({ width: 15 })),
    ...months.map(() => ({ width: 13 })),
    { width: 18 },
    { width: 18 },
  ];
  const title = sheet.addRow(["Scorecard budget — workings"]);
  title.font = { bold: true, size: 14, color: { argb: NAVY } };
  sheet.addRow([
    "The revised quarterly revenue budget (30 Sep 2026), a third of each quarter in each of its months. " +
      `The window is the months flagged 1. Collection is ${Math.round(COLLECTION_BUDGET_RATIO * 100)}% of revenue. Rupees.`,
  ]).font = { size: 10, italic: true, color: { argb: GREY } };
  sheet.addRow([]);

  const flagRow = sheet.addRow([
    "In the window? (1 = yes)",
    "",
    "",
    "",
    "",
    ...months.map((m) => (inWindow(m) ? 1 : 0)),
  ]);
  flagRow.font = { italic: true, color: { argb: GREY } };

  const header = sheet.addRow([
    "Vertical",
    "Q1 (Apr-Jun)",
    "Q2 (Jul-Sep)",
    "Q3 (Oct-Dec)",
    "Q4 (Jan-Mar)",
    ...months.map((m) => m.label),
    "Revenue budget for the window",
    "Collection budget for the window",
  ]);
  header.height = 30;
  header.eachCell((cell, i) => {
    cell.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    cell.alignment = { vertical: "middle", wrapText: true, horizontal: i === 1 ? "left" : "right" };
  });
  sheet.views = [{ state: "frozen", xSplit: 1, ySplit: header.number }];
  if (header.number !== FIRST - 1) throw new Error("budget workings head must be five rows");

  const monthCol = (i: number) => letter(6 + i); // F onward
  const windowCol = letter(6 + 12); // R
  const flags = `$${monthCol(0)}$${flagRow.number}:$${monthCol(11)}$${flagRow.number}`;
  // The same vertical order as every other sheet, so a link is one cell to one cell.
  const listed = isPartial ? shown : data.rows;

  listed.forEach((r, idx) => {
    const rowNo = FIRST + idx;
    const q = table[r.code] ?? [0, 0, 0, 0];
    const cells: (number | string | { formula: string; result?: number })[] = [r.label, ...q];
    months.forEach((m) => {
      const qCell = letter(2 + (m.quarter - 1));
      cells.push({ formula: `${qCell}${rowNo}/3`, result: q[m.quarter - 1] / 3 });
    });
    const revenue = months.reduce((s, m) => s + (inWindow(m) ? q[m.quarter - 1] / 3 : 0), 0);
    cells.push({
      formula: `SUMPRODUCT(${monthCol(0)}${rowNo}:${monthCol(11)}${rowNo},${flags})`,
      result: revenue,
    });
    cells.push({
      formula: `${windowCol}${rowNo}*${COLLECTION_BUDGET_RATIO}`,
      result: revenue * COLLECTION_BUDGET_RATIO,
    });
    const row = sheet.addRow(cells);
    row.eachCell({ includeEmpty: true }, (cell, i) => {
      if (i > 1) cell.numFmt = RS2;
      cell.border = { bottom: { style: "hair", color: { argb: RULE } } };
    });
  });

  // The entity as a whole, so the budget columns on the parameter sheets have a total to link to.
  const totalRowNo = FIRST + listed.length;
  const totals: (string | { formula: string; result?: number })[] = ["Entity as a whole"];
  for (let c = 2; c <= 5 + 12 + 2; c++) {
    const L = letter(c);
    totals.push({ formula: `SUM(${L}${FIRST}:${L}${totalRowNo - 1})` });
  }
  const totalRow = sheet.addRow(totals);
  totalRow.font = { bold: true };
  totalRow.eachCell({ includeEmpty: true }, (cell, i) => {
    if (i > 1) cell.numFmt = RS2;
    cell.border = { top: { style: "thin", color: { argb: NAVY } } };
  });
}

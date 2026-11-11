import type ExcelJS from "exceljs";
import { round2, sectionOf, strikeMonth, type HistoricalPlMonth } from "@/lib/historical-pl";
import { readWorkbook } from "./workbook";

/**
 * The accountant's monthly Profit and Loss (Zoho Books, accrual basis): one sheet per month,
 * each headed
 *
 *   RBJV & Associates / Profit and Loss / Basis: Accrual / From 01/04/2023 To 30/04/2023
 *
 * and then Account | Account Code | Total, with the accounts indented under a section heading
 * (Operating Income, Cost of Goods Sold, Operating Expense, Non Operating Income, Non Operating
 * Expense). A workbook is normally a year of twelve sheets; any number of sheets is read, and
 * a sheet whose period is not a single whole month is left out with a warning.
 */

export interface HistoricalPlParseResult {
  months: HistoricalPlMonth[];
  companyName: string | null;
  warnings: string[];
  detected: { sheets: number; firstMonth: string | null; lastMonth: string | null };
}

function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    if ("result" in v && v.result !== undefined && v.result !== null) return String(v.result);
    if ("richText" in v && Array.isArray(v.richText)) return v.richText.map((p) => p.text).join("");
    if ("text" in v && typeof v.text === "string") return v.text;
  }
  return String(v);
}

function cellNumber(cell: ExcelJS.Cell): number | null {
  const v = cell.value;
  if (typeof v === "number") return v;
  if (v && typeof v === "object" && "result" in v && typeof v.result === "number") return v.result;
  return null;
}

/** "From 01/04/2023 To 30/04/2023" -> the two dates, as ISO. Dates are day-first. */
function readPeriod(title: string): { from: string; to: string } | null {
  const m = title.match(/From\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\s+To\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
  if (!m) return null;
  const pad = (s: string) => s.padStart(2, "0");
  return { from: `${m[3]}-${pad(m[2])}-${pad(m[1])}`, to: `${m[6]}-${pad(m[5])}-${pad(m[4])}` };
}

const lastDayOf = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

export async function parseHistoricalPl(input: Buffer | ArrayBuffer): Promise<HistoricalPlParseResult> {
  const workbook = await readWorkbook(input);
  const warnings: string[] = [];
  const byMonth = new Map<string, HistoricalPlMonth>();
  let companyName: string | null = null;
  let sheets = 0;

  workbook.eachSheet((sheet) => {
    // The heading is in the first cell, over several lines.
    const title = cellText(sheet.getRow(1).getCell(1));
    const period = readPeriod(title);
    if (!period) {
      warnings.push(`Sheet "${sheet.name}" was skipped: no "From … To …" period in its heading.`);
      return;
    }
    const [y, mo, d1] = period.from.split("-").map(Number);
    const [y2, mo2, d2] = period.to.split("-").map(Number);
    if (y !== y2 || mo !== mo2 || d1 !== 1 || d2 !== lastDayOf(y, mo)) {
      warnings.push(
        `Sheet "${sheet.name}" was skipped: it covers ${period.from} to ${period.to}, not one whole month.`,
      );
      return;
    }
    sheets++;
    companyName ??= title.split("\n")[0].trim() || null;

    const sections: Record<string, Record<string, number>> = {};
    let section: ReturnType<typeof sectionOf> = null;
    let reportedNet: number | null = null;

    for (let r = 2; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const raw = cellText(row.getCell(1));
      const name = raw.trim();
      if (!name) continue;
      const amount = cellNumber(row.getCell(3));
      const indented = raw.length - raw.trimStart().length > 0;

      if (!indented) {
        const heading = sectionOf(name);
        if (heading && amount === null) {
          section = heading;
          continue;
        }
        if (/^net profit/i.test(name) && amount !== null) reportedNet = amount;
        continue;
      }
      if (!section || amount === null || /^total for /i.test(name)) continue;
      sections[section] ??= {};
      sections[section][name] = round2((sections[section][name] ?? 0) + amount);
    }

    if (Object.keys(sections).length === 0) {
      warnings.push(`Sheet "${sheet.name}" was skipped: no accounts were found under Operating Income or Operating Expense.`);
      return;
    }
    if (Object.values(sections.oci ?? {}).some((v) => Math.abs(v) > 0.5)) {
      warnings.push(`${sheet.name}: other comprehensive income is not nil; it is left out of the comparison.`);
    }

    const struck = strikeMonth(sections);
    if (reportedNet !== null && Math.abs(struck.netProfit - reportedNet) > 1) {
      warnings.push(
        `${sheet.name}: the accounts add up to a net profit of ${struck.netProfit.toLocaleString("en-IN")}, ` +
          `but the sheet's own Net Profit/Loss is ${reportedNet.toLocaleString("en-IN")}. Check that no account was left out.`,
      );
    }

    const key = `${y}-${String(mo).padStart(2, "0")}`;
    if (byMonth.has(key)) {
      warnings.push(`${key} appears on more than one sheet; the later sheet "${sheet.name}" is the one kept.`);
    }
    byMonth.set(key, {
      month: key,
      sheetName: sheet.name,
      revenue: struck.revenue,
      expenses: struck.expenses,
      otherNet: struck.otherNet,
      taxBooked: struck.taxBooked,
      reportedNet,
      lines: sections,
    });
  });

  const months = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
  if (months.length === 0) {
    throw new Error(
      'No monthly Profit and Loss sheets were found. Each sheet should be headed "Profit and Loss … From 01/04/2023 To 30/04/2023" with the accounts below.',
    );
  }
  return {
    months,
    companyName,
    warnings,
    detected: { sheets, firstMonth: months[0].month, lastMonth: months[months.length - 1].month },
  };
}

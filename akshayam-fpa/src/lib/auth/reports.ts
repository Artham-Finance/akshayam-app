/**
 * The report pages a person's per-user grant (`user_report_access`) can
 * cover, on top of which companies they may see.
 *
 * Kept separate from `dal.ts` (which is server-only) because `Nav.tsx`, a
 * client component, needs the same codes and labels to filter its tabs.
 */

export const REPORT_CODES = ["pnl", "revenue", "receivables", "collections", "scorecard"] as const;

export type ReportCode = (typeof REPORT_CODES)[number];

export function isReportCode(value: string): value is ReportCode {
  return (REPORT_CODES as readonly string[]).includes(value);
}

export const REPORT_LABEL: Record<ReportCode, string> = {
  pnl: "Profit & Loss",
  revenue: "Revenue",
  receivables: "Receivables",
  collections: "Collections",
  scorecard: "Vertical Performance Scorecard",
};

/** The nav tab, and page, each code gates. */
export const REPORT_HREF: Record<ReportCode, string> = {
  pnl: "/pnl",
  revenue: "/revenue",
  receivables: "/receivables",
  collections: "/collections",
  scorecard: "/scorecard",
};

export const HREF_TO_REPORT_CODE: Partial<Record<string, ReportCode>> = Object.fromEntries(
  REPORT_CODES.map((code) => [REPORT_HREF[code], code]),
);

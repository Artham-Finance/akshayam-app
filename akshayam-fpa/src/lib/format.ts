/**
 * Number and date formatting for Indian financial reporting.
 * Grouping is Indian (1,23,45,678) throughout - en-IN does this natively.
 */

const inr0 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export type Scale = "abs" | "thousands" | "lakhs" | "crores";

/** Rupees with Indian grouping, no symbol. Negatives are returned unsigned - the
 *  caller decides whether to show a minus or accounting brackets. */
export function money(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  const abs = Math.abs(value);
  return decimals === 0 ? inr0.format(Math.round(abs)) : inr2.format(abs);
}

/** Signed rupee figure, e.g. "-12,34,567". */
export function moneySigned(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  const body = money(value, decimals);
  return value < 0 ? `-${body}` : body;
}

/** Scale a raw rupee figure for display in a statement column. */
export function scaled(value: number, scale: Scale): number {
  switch (scale) {
    case "thousands":
      return value / 1_000;
    case "lakhs":
      return value / 100_000;
    case "crores":
      return value / 10_000_000;
    default:
      return value;
  }
}

export const scaleLabel: Record<Scale, string> = {
  abs: "in rupees",
  thousands: "in thousands",
  lakhs: "in lakhs",
  crores: "in crores",
};

/**
 * Short, readable form for KPI tiles: 1.24 Cr / 45.6 L / 82.3 K.
 * Crossing to crores at 1 Cr and lakhs at 1 L keeps the number of digits
 * roughly constant, which is what makes a tile row scannable.
 */
export function compactINR(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 10_000_000) return `${sign}${(abs / 10_000_000).toFixed(2)} Cr`;
  if (abs >= 100_000) return `${sign}${(abs / 100_000).toFixed(1)} L`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)} K`;
  return `${sign}${inr0.format(Math.round(abs))}`;
}

/** Percentage with a fixed 1 decimal, e.g. "18.4%". */
export function percent(value: number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return `${value.toFixed(decimals)}%`;
}

/** Growth between two figures, guarding the divide-by-zero and sign-flip cases
 *  that make naive percentage growth misleading. */
export function growth(current: number, prior: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(prior)) return null;
  if (prior === 0) return null;
  // Growing from a loss to a profit is not a meaningful percentage.
  if (prior < 0 && current > 0) return null;
  return ((current - prior) / Math.abs(prior)) * 100;
}

/** Ratio of part to whole as a percentage, safe when whole is zero. */
export function share(part: number, whole: number): number | null {
  if (!whole) return null;
  return (part / whole) * 100;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "2025-06-30" -> "Jun 25" */
export function monthLabel(iso: string): string {
  const [y, m] = iso.split("-");
  return `${MONTHS[Number(m) - 1]} ${y.slice(2)}`;
}

/** "2025-06-30" -> "30 Jun 2025" */
export function dateLabel(iso: string | null | undefined): string {
  if (!iso) return "-";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d} ${MONTHS[Number(m) - 1]} ${y}`;
}

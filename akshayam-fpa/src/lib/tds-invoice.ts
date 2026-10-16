/**
 * The 10% TDS on an invoice value keyed as free text - free of any database import, so
 * the TDS receivables tab (in the browser) and the report can work it out the same way.
 */

/** TDS is deducted at 10% of the invoice value. */
export const TDS_RATE = 0.1;

/**
 * The number in a free-text invoice value ("1,25,000", "₹ 50000", "Rs. 1,000.50"), or null
 * when there is none to read. A value is the digits and one decimal point; anything else
 * around it - currency marks, commas, spaces - is ignored.
 */
export function parseInvoiceValue(text: string | null | undefined): number | null {
  const cleaned = (text ?? "").replace(/rs\.?|inr|[,\s₹]/gi, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** 10% of an invoice value, to the paisa, or null where the value is not a number. */
export function tdsOnInvoice(text: string | null | undefined): number | null {
  const n = parseInvoiceValue(text);
  return n === null ? null : Math.round(n * TDS_RATE * 100) / 100;
}

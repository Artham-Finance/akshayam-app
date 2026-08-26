/**
 * Building links that keep the page's context.
 *
 * Every reporting page is driven by query parameters - financial year, vertical
 * and now the drill-down - and a link that sets one must not silently drop the
 * others. Opening the receipts behind a figure should show the receipts behind
 * *that* figure, not the same tile for the whole year.
 */
export type Params = Record<string, string | string[] | undefined>;

export function withParams(
  path: string,
  current: Params,
  changes: Record<string, string | number | null>,
): string {
  const next = new URLSearchParams();

  for (const [key, value] of Object.entries(current)) {
    if (value === undefined) continue;
    next.set(key, Array.isArray(value) ? (value[0] ?? "") : value);
  }
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === "") next.delete(key);
    else next.set(key, String(value));
  }

  const qs = next.toString();
  return qs ? `${path}?${qs}` : path;
}

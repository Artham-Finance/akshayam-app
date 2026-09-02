/**
 * The scorecard's rating bands and weights, from the partners' TL-rating
 * workbook. Kept free of any database import so scripts/check-statements.mts
 * can exercise the arithmetic without a connection.
 */

export const WEIGHTS = {
  revenue: 0.1,
  collection: 0.15,
  netRevContrib: 0.2,
  netCollContrib: 0.3,
  ageing: 0.1,
  mgmt: 0.15,
} as const;

/** The workbook fixes this at 3 for everyone; a real appraisal store comes later. */
export const MGMT_APPRAISAL_DEFAULT = 3;

/** achievement fraction (actual / budget) -> 0..4 */
export function rateBudgetAchievement(frac: number | null): number {
  if (frac === null || !Number.isFinite(frac)) return 0;
  if (frac >= 1) return 4;
  if (frac > 0.8) return 3;
  if (frac > 0.6) return 2;
  if (frac > 0.4) return 1;
  return 0;
}

/** contribution share (0..1) -> 0..4 */
export function rateContributionShare(share: number | null): number {
  if (share === null || !Number.isFinite(share)) return 0;
  if (share >= 0.2) return 4;
  if (share >= 0.15) return 3;
  if (share >= 0.1) return 2;
  if (share >= 0.05) return 1;
  return 0;
}

/** weighted-average ageing days -> 0..4 (0 days, i.e. nothing outstanding, is best) */
export function rateAgeingDays(days: number | null): number {
  if (days === null || !Number.isFinite(days)) return 0;
  if (days <= 15) return 4;
  if (days <= 45) return 3;
  if (days <= 75) return 2;
  if (days <= 135) return 1;
  return 0;
}

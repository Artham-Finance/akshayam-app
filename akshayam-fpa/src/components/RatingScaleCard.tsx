import { Card, CardTitle } from "@/components/ui";
import { DataTable } from "@/components/DataTable";
import {
  MGMT_APPRAISAL_DEFAULT,
  rateAgeingDays,
  rateBudgetAchievement,
  rateContributionShare,
} from "@/lib/reports/scorecard-rating";

/**
 * What each 0-4 rating means, per metric.
 *
 * The bands are read off the real rating functions rather than restated by
 * hand: each threshold is probed to see which side of it the boundary value
 * itself falls on. A card that quietly disagrees with the arithmetic is worse
 * than no card, and this one cannot - change a threshold in
 * scorecard-rating.ts and this table follows.
 *
 * The distinction matters here because the functions are not consistent with
 * each other: budget achievement uses exclusive comparisons, so exactly 80%
 * rates 2, while contribution uses inclusive ones, so exactly 15% rates 3.
 */

/**
 * Band labels for a rating function, highest rating first.
 *
 * @param rate       the function under description
 * @param thresholds the round numbers it turns on, ascending
 * @param fmt        how to write one of those numbers
 * @param descending true when a lower input is better, as with ageing days
 * @param step       the smallest step that matters, for "the value just below"
 */
function bandLabels(
  rate: (v: number | null) => number,
  thresholds: number[],
  fmt: (n: number) => string,
  descending = false,
  step = 0.01,
): string[] {
  const top = thresholds.length; // rating 4 with four thresholds
  const labels: string[] = [];

  for (let r = top; r >= 0; r--) {
    if (descending) {
      // Lower is better: rating 4 is at or below the first threshold.
      if (r === top) {
        labels.push(`${fmt(thresholds[0])} or fewer`);
      } else if (r === 0) {
        labels.push(`over ${fmt(thresholds[thresholds.length - 1])}`);
      } else {
        const lower = thresholds[top - r - 1];
        const upper = thresholds[top - r];
        // Only the upper bound carries the unit: "16 to 45 days", not "16 days to 45 days".
        labels.push(`${lower + step} to ${fmt(upper)}`);
      }
      continue;
    }

    if (r === top) {
      const edge = thresholds[thresholds.length - 1];
      labels.push(rate(edge) === r ? `${fmt(edge)} or more` : `over ${fmt(edge)}`);
      continue;
    }
    if (r === 0) {
      const edge = thresholds[0];
      labels.push(rate(edge) === 0 ? `${fmt(edge)} or less` : `under ${fmt(edge)}`);
      continue;
    }

    const lower = thresholds[r - 1];
    const upper = thresholds[r];
    const upperText = rate(upper) === r ? `up to ${fmt(upper)}` : `under ${fmt(upper)}`;
    // An inclusive lower bound reads as a range ("15% to under 20%"); an
    // exclusive one has to say so ("over 80%, under 100%").
    labels.push(
      rate(lower) === r
        ? `${fmt(lower)} to ${upperText}`
        : `over ${fmt(lower)}, ${upperText}`,
    );
  }

  return labels;
}

const asPercent = (n: number) => `${Math.round(n * 100)}%`;
const asDays = (n: number) => `${Math.round(n)} days`;

export function RatingScaleCard() {
  const budget = bandLabels(rateBudgetAchievement, [0.4, 0.6, 0.8, 1], asPercent);
  const contribution = bandLabels(rateContributionShare, [0.05, 0.1, 0.15, 0.2], asPercent);
  const ageing = bandLabels(rateAgeingDays, [15, 45, 75, 135], asDays, true, 1);

  return (
    <Card padded={false}>
      <div className="p-4 sm:p-5">
        <CardTitle hint="0 = worst · 4 = best">Basis of rating</CardTitle>
        <p className="-mt-1 text-[12.5px] leading-relaxed text-ink-muted">
          Each metric is rated 0 to 4 on the bands below, then combined into the composite
          using the weights above. The two budget metrics measure a vertical against its own
          target; the two contribution metrics measure its share of the whole firm &mdash; so a
          small vertical can beat its budget and still rate low on contribution.
        </p>
      </div>

      <DataTable
        columns={[
          { header: "Metric" },
          { header: "Measured as" },
          { header: "Rated 4", numeric: true, strong: true },
          { header: "3", numeric: true },
          { header: "2", numeric: true },
          { header: "1", numeric: true },
          { header: "0", numeric: true },
        ]}
        rows={[
          ["Revenue vs budget", "Revenue ÷ budget", ...budget],
          ["Collection vs budget", "Collections ÷ budget", ...budget],
          ["Net revenue contribution", "Share of firm revenue", ...contribution],
          ["Net collection contribution", "Share of firm collections", ...contribution],
          ["Receivables ageing", "Weighted-average days outstanding", ...ageing],
          [
            "Management appraisal",
            "Partners' assessment",
            ...[4, 3, 2, 1, 0].map((r) => (r === MGMT_APPRAISAL_DEFAULT ? "set for all" : "—")),
          ],
        ]}
      />

      <p className="px-4 py-3 text-[11.5px] leading-relaxed text-ink-faint sm:px-5">
        Receivables ageing is the one metric where a lower number is better, so its bands run
        the other way. Management appraisal is fixed at{" "}
        <span className="font-medium text-ink-muted">{MGMT_APPRAISAL_DEFAULT}</span> for every
        vertical &mdash; it is the partners&rsquo; own assessment and there is nowhere yet to
        record it, so at present it neither rewards nor penalises anyone.
      </p>
    </Card>
  );
}

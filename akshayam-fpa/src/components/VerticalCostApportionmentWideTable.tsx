"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { money, scaled, scaleLabel, type Scale } from "@/lib/format";
// Types only from the report itself: importing a value from it would pull the
// database driver into the browser bundle.
import type { VerticalCostApportionmentResult } from "@/lib/reports/vertical-cost-apportionment";
import { ExpandableRow, HeadInput, Row } from "@/components/VerticalCostApportionmentTable";

/**
 * Comparison only, alongside the primary apportionment card - the same two
 * pools (Common's own cost, and ACC's and HRCM's combined), spread on the
 * same head-count rule but over every head in the entity rather than just
 * the six receiving verticals. Revenue and direct cost are each vertical's
 * own and are identical to the primary card; only the two apportioned lines
 * and everything under them differ, because the wider denominator leaves
 * most of each pool uncharged to any of the six - shown below as the
 * balance still to be allocated.
 */
export function VerticalCostApportionmentWideTable({
  data,
  initialScale = "abs",
  canEditHeads = false,
}: {
  data: VerticalCostApportionmentResult;
  initialScale?: Scale;
  /** the viewer may key the company's total head count in - only takes effect on a single-month view */
  canEditHeads?: boolean;
}) {
  const router = useRouter();
  const [scale, setScale] = useState<Scale>(initialScale);
  const [showDetail, setShowDetail] = useState(false);
  const [applyForward, setApplyForward] = useState(true);
  const [saving, startSave] = useTransition();

  const editHeads = canEditHeads && data.month !== null && data.wide.entityId !== null;

  const saveCompanyHeads = async (heads: number) => {
    if (data.wide.entityId === null) return;
    try {
      await fetch("/api/company-headcount", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entityId: data.wide.entityId,
          fyStartYear: data.fyStartYear,
          month: `${data.month}-01`,
          heads,
          applyForward,
        }),
      });
      startSave(() => router.refresh());
    } catch {
      /* a failed save leaves the field as typed; the next edit retries */
    }
  };

  const show = (value: number) =>
    money(scaled(value, scale), scale === "abs" || scale === "thousands" ? 0 : 2);

  const head =
    "border-y border-line px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-faint";

  const total = (pick: (v: (typeof data.verticals)[number]) => number) =>
    data.verticals.reduce((sum, v) => sum + pick(v), 0);

  /** Narrowed to a single vertical, the total column would repeat the only column beside it. */
  const showTotal = data.verticals.length > 1;

  const contribution = total((v) => v.contributionWide);
  const unapportioned = data.wide.commonUnapportioned + data.wide.accHrcmUnapportioned;

  return (
    <>
      <div className="no-print flex flex-wrap items-center justify-between gap-3 px-3 pb-3">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setShowDetail((v) => !v)}
            className="rounded-md border border-line px-2.5 py-1.5 text-[12px] font-medium text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
          >
            {showDetail ? "Hide cost detail" : "Show cost detail"}
          </button>
          {editHeads && (
            <label className="flex items-center gap-1.5 text-[12px] text-ink-muted">
              <input
                type="checkbox"
                checked={applyForward}
                onChange={(e) => setApplyForward(e.target.checked)}
                className="accent-navy"
              />
              Apply to {data.label} and the rest of the year
            </label>
          )}
        </div>

        <label className="flex items-center gap-2 text-[12px] text-ink-muted">
          <span>Figures</span>
          <select
            value={scale}
            onChange={(e) => setScale(e.target.value as Scale)}
            className="rounded-md border border-line bg-surface px-2 py-1.5 text-[12px] text-ink"
          >
            <option value="abs">in rupees</option>
            <option value="thousands">in thousands</option>
            <option value="lakhs">in lakhs</option>
            <option value="crores">in crores</option>
          </select>
        </label>
      </div>

      <p className="px-3 pb-3 text-[11.5px] text-ink-muted">
        Same pools as the card above, spread instead over {data.wide.totalCompanyHeads.toFixed(2)}{" "}
        heads across the whole entity, not just these six ({data.totalHeads.toFixed(2)}). Of{" "}
        {show(data.poolTotal + data.accHrcmPoolTotal)} pooled, only{" "}
        {show(data.poolTotal + data.accHrcmPoolTotal - unapportioned)} lands on the six below; the
        remaining {show(unapportioned)} sits on heads outside them and stays unallocated here.
        {scale !== "abs" && ` All figures ${scaleLabel[scale].toLowerCase()}.`}
      </p>

      <div className="overflow-x-auto">
        <table className="min-w-max border-collapse text-[13px] w-full">
          <thead>
            <tr>
              <th scope="col" className={`${head} text-left`}>
                Particulars
              </th>
              {data.verticals.map((v) => (
                <th key={v.key} scope="col" className={`${head} text-right`}>
                  {v.label}
                </th>
              ))}
              {showTotal && (
                <th scope="col" className={`${head} border-l border-line text-right`}>
                  Total
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            <Row
              verticals={data.verticals}
              showTotal={showTotal}
              show={show}
              label="Head count"
              pick={(v) => v.heads}
              raw
            />
            <tr className="hover:bg-surface-sunk/50">
              <th scope="row" className="border-b border-line px-3 py-2 text-left font-normal text-ink">
                Total company head count
                <span className="block text-[10px] font-normal text-ink-faint">
                  every vertical in the entity, not just these six
                  {editHeads
                    ? ` · ${data.label}${applyForward ? " · fills the rest of the year" : ""}`
                    : canEditHeads
                      ? " · pick a month above to key it in"
                      : !data.wide.companyHeadsIsKeyed
                        ? " · estimated from tracked verticals only, not yet keyed in"
                        : ""}
                </span>
              </th>
              <td
                colSpan={data.verticals.length + (showTotal ? 1 : 0)}
                className="num border-b border-line px-3 py-2 text-right text-ink"
              >
                {editHeads ? (
                  <HeadInput
                    value={data.wide.totalCompanyHeads}
                    disabled={saving}
                    onSave={saveCompanyHeads}
                  />
                ) : (
                  data.wide.totalCompanyHeads.toFixed(2)
                )}
              </td>
            </tr>
            <Row
              verticals={data.verticals}
              showTotal={showTotal}
              show={show}
              label="Revenue"
              pick={(v) => v.revenue}
              tone="ink"
            />

            <ExpandableRow
              verticals={data.verticals}
              showTotal={showTotal}
              show={show}
              showDetail={showDetail}
              label="Direct team cost"
              pick={(v) => v.directTeamCost}
              lines={data.directTeamCostLines}
            />
            <ExpandableRow
              verticals={data.verticals}
              showTotal={showTotal}
              show={show}
              showDetail={showDetail}
              label="Direct overheads"
              pick={(v) => v.directOverheads}
              lines={data.directOverheadLines}
            />
            <ExpandableRow
              verticals={data.verticals}
              showTotal={showTotal}
              show={show}
              showDetail={showDetail}
              label="Common cost — apportioned (company-wide heads)"
              pick={(v) => v.commonApportionedWide}
              lines={data.wide.commonCostLines}
            />
            <ExpandableRow
              verticals={data.verticals}
              showTotal={showTotal}
              show={show}
              showDetail={showDetail}
              label="ACC and HRCM cost — apportioned (company-wide heads)"
              pick={(v) => v.accHrcmApportionedWide}
              lines={data.wide.accHrcmCostLines}
            />

            <Row
              verticals={data.verticals}
              showTotal={showTotal}
              show={show}
              label="Total cost"
              pick={(v) => v.totalCostWide}
              tone="strong"
              rule
            />
            <Row
              verticals={data.verticals}
              showTotal={showTotal}
              show={show}
              label="Contribution"
              pick={(v) => v.contributionWide}
              tone="result"
            />
          </tbody>
        </table>
      </div>

      <p className="px-3 py-3 text-[11.5px] leading-relaxed text-ink-muted">
        {showTotal ? (
          <>
            Total contribution of {show(contribution)} on this basis, against{" "}
            {show(data.verticals.reduce((s, v) => s + v.contribution, 0))} on the head-count-of-six
            basis above — the gap is exactly the {show(unapportioned)} left unallocated: still a
            real cost, just not yet charged to any of these six verticals.
          </>
        ) : (
          <>
            Contribution of {show(contribution)} is this vertical&rsquo;s share on the wider
            denominator, against {show(data.verticals[0]?.contribution ?? 0)} on the
            head-count-of-six basis above. The spread was struck across all six and then narrowed
            to this one; the share does not change with the filter.
          </>
        )}
      </p>
    </>
  );
}

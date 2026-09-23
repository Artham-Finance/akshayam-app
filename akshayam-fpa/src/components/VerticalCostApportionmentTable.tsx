"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import clsx from "clsx";
import { money, scaled, scaleLabel, type Scale } from "@/lib/format";
// Types only from the report itself: importing a value from it would pull the
// database driver into the browser bundle.
import type {
  ApportionedVerticalCost,
  CostAccountLine,
  VerticalCostApportionmentResult,
} from "@/lib/reports/vertical-cost-apportionment";

/**
 * Vertical-wise P&L after cost apportionment, for VPP - six verticals across
 * the top, cost broken into direct team cost, direct overheads and Common's
 * own cost spread by head count, each expandable to the accounts behind it.
 */
export function VerticalCostApportionmentTable({
  data,
  initialScale = "abs",
  canEditHeads = false,
  compact = false,
}: {
  data: VerticalCostApportionmentResult;
  initialScale?: Scale;
  /** the viewer may key head count in - only takes effect on a single-month view */
  canEditHeads?: boolean;
  /**
   * Figures only, no expand and no head-count editing - for a team lead's own
   * vertical, narrowed to one column, where the accounts behind a figure are
   * not this login's to see.
   */
  compact?: boolean;
}) {
  const router = useRouter();
  const [scale, setScale] = useState<Scale>(initialScale);
  const [showDetail, setShowDetail] = useState(false);
  const [applyForward, setApplyForward] = useState(true);
  const [saving, startSave] = useTransition();

  const editHeads = !compact && canEditHeads && data.month !== null;

  const saveHeads = async (verticalId: number, heads: number) => {
    try {
      await fetch("/api/vertical-headcount", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          verticalId,
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

  const total = (pick: (v: ApportionedVerticalCost) => number) =>
    data.verticals.reduce((sum, v) => sum + pick(v), 0);

  /** Narrowed to a single vertical, the total column would repeat the only column beside it. */
  const showTotal = data.verticals.length > 1;

  const contribution = total((v) => v.contribution);

  return (
    <>
      <div className="no-print flex flex-wrap items-center justify-between gap-3 px-3 pb-3">
        <div className="flex flex-wrap items-center gap-3">
          {!compact && (
            <button
              type="button"
              onClick={() => setShowDetail((v) => !v)}
              className="rounded-md border border-line px-2.5 py-1.5 text-[12px] font-medium text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
            >
              {showDetail ? "Hide cost detail" : "Show cost detail"}
            </button>
          )}
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
        {show(data.poolTotal)} of common cost and {show(data.accHrcmPoolTotal)} of ACC and HRCM
        cost spread over {data.label}, on head count only, across the six verticals below. Cost
        already tagged to a vertical is its own and is never re-spread; only Common&rsquo;s and ACC
        and HRCM&rsquo;s activity is pooled and spread this way — any other vertical&rsquo;s
        activity plays no part in this card.
        {scale !== "abs" && ` All figures ${scaleLabel[scale].toLowerCase()}.`}
      </p>

      <div className="overflow-x-auto">
        <table
          className={clsx("min-w-max border-collapse text-[13px]", showTotal ? "w-full" : "w-auto")}
        >
          <thead>
            <tr>
              <th scope="col" className={clsx(head, "text-left")}>
                Particulars
              </th>
              {data.verticals.map((v) => (
                <th
                  key={v.key}
                  scope="col"
                  className={clsx(head, "text-right", !showTotal && "min-w-[170px]")}
                >
                  {v.label}
                </th>
              ))}
              {showTotal && (
                <th scope="col" className={clsx(head, "border-l border-line text-right")}>
                  Total
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {editHeads ? (
              <tr className="hover:bg-surface-sunk/50">
                <th scope="row" className="border-b border-line px-3 py-2 text-left font-normal text-ink">
                  Head count
                  <span className="block text-[10px] font-normal text-ink-faint">
                    {data.label} · keyed{applyForward ? " · fills the rest of the year" : ""}
                  </span>
                </th>
                {data.verticals.map((v) => (
                  <td key={v.key} className="num border-b border-line px-3 py-2 text-right text-ink-faint">
                    {v.verticalId != null ? (
                      <HeadInput value={v.heads} disabled={saving} onSave={(h) => saveHeads(v.verticalId!, h)} />
                    ) : (
                      "—"
                    )}
                  </td>
                ))}
                {showTotal && (
                  <td className="num border-b border-line border-l border-line px-3 py-2 text-right font-semibold text-ink">
                    {String(total((v) => v.heads))}
                  </td>
                )}
              </tr>
            ) : (
              <Row
                verticals={data.verticals}
                showTotal={showTotal}
                show={show}
                label="Head count"
                pick={(v) => v.heads}
                raw
                note={canEditHeads ? "pick a month above to key it in" : undefined}
              />
            )}
            <Row verticals={data.verticals} showTotal={showTotal} show={show} label="Revenue" pick={(v) => v.revenue} tone="ink" />

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
              label="Common cost — apportioned"
              pick={(v) => v.commonApportioned}
              lines={data.commonCostLines}
            />
            <ExpandableRow
              verticals={data.verticals}
              showTotal={showTotal}
              show={show}
              showDetail={showDetail}
              label="ACC and HRCM cost — apportioned"
              pick={(v) => v.accHrcmApportioned}
              lines={data.accHrcmCostLines}
            />

            <Row verticals={data.verticals} showTotal={showTotal} show={show} label="Total cost" pick={(v) => v.totalCost} tone="strong" rule />
            <Row verticals={data.verticals} showTotal={showTotal} show={show} label="Contribution" pick={(v) => v.contribution} tone="result" />
          </tbody>
        </table>
      </div>

      <p className="px-3 py-3 text-[11.5px] leading-relaxed text-ink-muted">
        {showTotal ? (
          <>
            Total contribution of {show(contribution)} across these six verticals — the figure VPP
            is struck on. Common&rsquo;s cost and ACC and HRCM&rsquo;s cost are each spread on head
            count alone, in proportion to each vertical&rsquo;s own head count over{" "}
            {data.totalHeads.toFixed(2)} total.
          </>
        ) : (
          <>
            Contribution of {show(contribution)} is this vertical&rsquo;s share, after its own
            direct cost and its head-count share of Common&rsquo;s cost and of ACC and
            HRCM&rsquo;s cost — the figure VPP is struck on. The spread was struck across all six
            verticals and then narrowed to this one; the share does not change with the filter.
          </>
        )}
      </p>
    </>
  );
}

/** One row: a label, a value per vertical, and the total across them. */
export function Row({
  verticals,
  showTotal,
  show,
  label,
  note,
  pick,
  tone = "muted",
  rule,
  raw,
}: {
  verticals: ApportionedVerticalCost[];
  showTotal: boolean;
  show: (value: number) => string;
  label: string;
  note?: string;
  pick: (v: ApportionedVerticalCost) => number;
  tone?: "muted" | "ink" | "strong" | "result";
  /** a heavier line above, where a section ends */
  rule?: boolean;
  /** a count rather than an amount, so the figure scale must not touch it */
  raw?: boolean;
}) {
  const total = verticals.reduce((sum, v) => sum + pick(v), 0);
  const cell = clsx(
    "num border-b border-line px-3 py-2 text-right",
    rule && "border-t border-line-strong",
    tone === "muted" && "text-ink-faint",
    tone === "ink" && "text-ink",
    tone === "strong" && "font-medium text-ink",
  );
  return (
    <tr className={clsx(tone === "result" && "bg-surface-sunk font-semibold", "hover:bg-surface-sunk/50")}>
      <th
        scope="row"
        className={clsx(
          "border-b border-line px-3 py-2 text-left text-ink",
          rule && "border-t border-line-strong",
          tone === "result" || tone === "strong" ? "font-semibold" : "font-normal",
        )}
      >
        {label}
        {note && <span className="block text-[10px] font-normal text-ink-faint">{note}</span>}
      </th>
      {verticals.map((v) => {
        const value = pick(v);
        return (
          <td
            key={v.key}
            className={clsx(
              cell,
              tone === "result" && (value < -0.5 ? "num-negative text-negative" : "text-positive"),
            )}
          >
            {value === 0 && tone === "muted" ? "—" : raw ? String(value) : show(value)}
          </td>
        );
      })}
      {showTotal && (
        <td className={clsx(cell, "border-l border-line font-semibold text-ink")}>
          {raw ? String(total) : show(total)}
        </td>
      )}
    </tr>
  );
}

/** A summary row that expands to the accounts behind it, indented beneath. */
export function ExpandableRow({
  verticals,
  showTotal,
  show,
  showDetail,
  label,
  pick,
  lines,
}: {
  verticals: ApportionedVerticalCost[];
  showTotal: boolean;
  show: (value: number) => string;
  showDetail: boolean;
  label: string;
  pick: (v: ApportionedVerticalCost) => number;
  lines: CostAccountLine[];
}) {
  return (
    <>
      <Row verticals={verticals} showTotal={showTotal} show={show} label={label} pick={pick} tone="strong" />
      {showDetail &&
        lines.map((line) => (
          <tr key={line.account} className="hover:bg-surface-sunk/50">
            <th scope="row" className="border-b border-line px-3 py-2 pl-6 text-left font-normal text-ink-muted">
              {line.account}
            </th>
            {verticals.map((v) => {
              const value = line.amountByKey[v.key] ?? 0;
              return (
                <td key={v.key} className="num border-b border-line px-3 py-2 text-right text-ink-faint">
                  {value === 0 ? "—" : show(value)}
                </td>
              );
            })}
            {showTotal && (
              <td className="num border-b border-line border-l border-line px-3 py-2 text-right text-ink-faint">
                {show(line.total)}
              </td>
            )}
          </tr>
        ))}
    </>
  );
}

/** A whole-number field for a vertical's head count in the chosen month. */
export function HeadInput({
  value,
  disabled,
  onSave,
}: {
  value: number;
  disabled: boolean;
  onSave: (v: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) return;
    const raw = draft.trim();
    setDraft(null);
    const n = raw === "" ? 0 : Number(raw);
    if (Number.isInteger(n) && n >= 0 && n !== value) onSave(n);
  };

  return (
    <input
      value={draft ?? String(value)}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ""))}
      onFocus={(e) => {
        setDraft(String(value));
        e.currentTarget.select();
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(null);
          e.currentTarget.blur();
        }
      }}
      inputMode="numeric"
      className="num w-14 rounded-md border border-line bg-surface px-1.5 py-0.5 text-right text-[12px] text-ink outline-none focus:border-navy disabled:opacity-50"
    />
  );
}

"use client";

import { useState } from "react";
import clsx from "clsx";
import { money, scaled, scaleLabel, type Scale } from "@/lib/format";
// Types only from the report itself: importing a value from it would pull the
// database driver into the browser bundle. The basis labels live in a module
// that holds data and nothing else.
import type {
  ApportionedVertical,
  ApportionmentResult,
} from "@/lib/reports/apportionment";
import { BASIS_LABEL, HEAD_BASIS } from "@/lib/reports/apportionment-rules";

/**
 * Common cost spread across the verticals that carry it, for the quarter.
 *
 * Laid out the way the budget's own apportionment statement is: heads of cost
 * down the side, verticals across the top. That is the orientation the reader
 * already knows, and it is the one the table is actually read in - across a
 * row, to see how one cost was split.
 *
 * The bases are the budget's own, so the share a vertical carries follows the
 * rule the partners agreed and only the amount moves as the year runs.
 * Contribution - revenue less every cost, direct and apportioned - is the line
 * VPP is struck on, so it is the one the table ends on.
 */
export function ApportionmentTable({
  data,
  initialScale = "abs",
}: {
  data: ApportionmentResult;
  initialScale?: Scale;
}) {
  const [scale, setScale] = useState<Scale>(initialScale);
  const [showHeads, setShowHeads] = useState(true);

  // Every figure in the table goes through this, so the scale can never apply
  // to some rows and not others. Lakhs and crores keep two decimals, the same
  // as the statement above - whole lakhs would round a vertical's whole
  // contribution to a single digit.
  const show = (value: number) =>
    money(scaled(value, scale), scale === "abs" || scale === "thousands" ? 0 : 2);

  const head =
    "border-y border-line px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-faint";

  const total = (pick: (v: ApportionedVertical) => number) =>
    data.verticals.reduce((sum, v) => sum + pick(v), 0);

  /**
   * Narrowed to a single vertical, the total column would repeat the only
   * column beside it. The apportionment behind the figures is still struck
   * across every vertical - it is the view that is narrowed, never the spread.
   */
  const showTotal = data.verticals.length > 1;

  /** One row: a label, a value per vertical, and the total across them. */
  const Row = ({
    label,
    note,
    pick,
    tone = "muted",
    rule,
    indent,
    raw,
  }: {
    label: string;
    note?: string;
    pick: (v: ApportionedVertical) => number;
    tone?: "muted" | "ink" | "strong" | "result";
    /** a heavier line above, where a section ends */
    rule?: boolean;
    indent?: boolean;
    /** a count rather than an amount, so the figure scale must not touch it */
    raw?: boolean;
  }) => {
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
            indent && "pl-6",
          )}
        >
          {label}
          {note && (
            <span className="block text-[10px] font-normal text-ink-faint">{note}</span>
          )}
        </th>
        {data.verticals.map((v) => {
          const value = pick(v);
          return (
            <td
              key={v.key}
              className={clsx(
                cell,
                tone === "result" &&
                  (value < -0.5 ? "num-negative text-negative" : "text-positive"),
              )}
            >
              {value === 0 && tone === "muted" ? "—" : raw ? String(value) : show(value)}
            </td>
          );
        })}
        {showTotal && (
          <td className={clsx(cell, "border-l border-line font-semibold text-ink")}>
            {raw ? String(total(pick)) : show(total(pick))}
          </td>
        )}
      </tr>
    );
  };

  const contribution = total((v) => v.contribution);

  return (
    <>
      <div className="no-print flex flex-wrap items-center justify-between gap-3 px-3 pb-3">
        <button
          type="button"
          onClick={() => setShowHeads((v) => !v)}
          className="rounded-md border border-line px-2.5 py-1.5 text-[12px] font-medium text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
        >
          {showHeads ? "Hide cost detail" : "Show cost detail"}
        </button>

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

      {/*
        A paragraph rather than a <caption>. A caption sits inside the table and
        so counts towards its max-content width - two sentences of prose were
        holding the label column open to the width of the longest line, which
        with a single vertical left its one figure stranded at the far edge.
      */}
      <p className="px-3 pb-3 text-[11.5px] text-ink-muted">
        {show(data.poolTotal)} of common cost spread over {data.label}, on the budget&rsquo;s own
        bases. Cost already tagged to a vertical is its own and is never re-spread.
        {scale !== "abs" && ` All figures ${scaleLabel[scale].toLowerCase()}.`}
      </p>

      <div className="overflow-x-auto">
      <table
        className={clsx(
          "min-w-max border-collapse text-[13px]",
          // Full width spreads twelve columns evenly; with one it would strand
          // the single figure against the right edge of the card.
          showTotal ? "w-full" : "w-auto",
        )}
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
                className={clsx(
                  head,
                  "text-right",
                  !showTotal && "min-w-[170px]",
                  // The lines outside the budget's nine are context, not
                  // participants; they carry no apportionment.
                  !v.receivesApportionment && "border-l border-line font-normal",
                )}
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
          <Row label="Head count" pick={(v) => v.heads} raw />
          <Row label="Revenue" pick={(v) => v.revenue} tone="ink" />
          <Row label="Direct cost" pick={(v) => v.directCost} tone="ink" />

          {showHeads &&
            data.heads.map((h, i) => (
              <Row
                key={h}
                label={h}
                note={BASIS_LABEL[HEAD_BASIS[h]]}
                pick={(v) => v.apportioned[h] ?? 0}
                indent
                rule={i === 0}
              />
            ))}

          <Row
            label="Apportioned common cost"
            pick={(v) => v.apportionedTotal}
            tone="strong"
          />
          <Row label="Total cost" pick={(v) => v.totalCost} tone="strong" rule />
          <Row label="Contribution" pick={(v) => v.contribution} tone="result" />
        </tbody>
      </table>
      </div>

      <p className="px-3 py-3 text-[11.5px] leading-relaxed text-ink-muted">
        {showTotal ? (
          <>
            Revenue, total cost and contribution add across to the quarter&rsquo;s figures on
            Budget vs Actual — total contribution of {show(contribution)} is the same EBITDA.
            The lines after the nine carry no apportionment: Common&rsquo;s cost{" "}
            <span className="italic">is</span> the pool and has already been spread above, so
            only its revenue appears.
          </>
        ) : (
          <>
            Contribution of {show(contribution)} is this vertical&rsquo;s share of EBITDA. The
            common cost above was spread across every vertical on the budget&rsquo;s bases and
            then narrowed to this one — the share does not change with the filter.
          </>
        )}
      </p>
    </>
  );
}

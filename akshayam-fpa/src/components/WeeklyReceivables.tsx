"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { dateLabel, money, percent } from "@/lib/format";
import type {
  Over180Customer,
  TopCustomer,
  VerticalReceivables,
  WeeklyReceivablesResult,
} from "@/lib/reports/weekly-receivables";

/**
 * The MAK meeting's Receivables tab: for each vertical, the receivables over
 * 90 days (up to 180) and over 180 days, each with what is committed for the week and
 * every earlier week's commitment on the customer; and the ten customers who owe the
 * most. (TDS has a tab of its own.)
 *
 * What is typed here is the head's own account: a commitment (editable until
 * the end of the day it was first keyed), and a review of the latest earlier one. The
 * figures are read fresh from the receivables snapshot.
 */

const th =
  "border-y border-line px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-faint";
const td = "border-b border-line px-3 py-2";
const field =
  "w-full rounded-md border border-line bg-surface px-2 py-1 text-[12px] text-ink placeholder:text-ink-faint";

async function save(body: Record<string, unknown>): Promise<string | null> {
  try {
    const response = await fetch("/api/weekly-receivables", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    return response.ok ? null : (payload.error ?? "Could not save.");
  } catch {
    return "Could not reach the server.";
  }
}

export function WeeklyReceivables({
  data,
  canCommit,
}: {
  data: WeeklyReceivablesResult;
  canCommit: boolean;
}) {
  const [open, setOpen] = useState<Set<number>>(
    () => new Set(data.verticals.slice(0, 1).map((v) => v.verticalId)),
  );
  const toggle = (id: number) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (data.verticals.length === 0) {
    return (
      <p className="px-4 py-6 text-[13px] text-ink-muted sm:px-5">
        No receivables are on file for the verticals in this view
        {data.arAsOf ? ` (snapshot ${dateLabel(data.arAsOf)})` : ""}.
      </p>
    );
  }

  return (
    <div className="divide-y divide-line">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-[12px] text-ink-muted sm:px-5">
        <span>
          Receivables as at {data.arAsOf ? dateLabel(data.arAsOf) : "—"} · whole entity{" "}
          <span className="num font-medium text-ink">{money(data.entityTotal)}</span>
        </span>
        <span className="flex gap-2">
          <button
            type="button"
            onClick={() => setOpen(new Set(data.verticals.map((v) => v.verticalId)))}
            className="hover:text-navy"
          >
            Expand all
          </button>
          <span className="text-ink-faint">·</span>
          <button type="button" onClick={() => setOpen(new Set())} className="hover:text-navy">
            Collapse all
          </button>
        </span>
      </div>

      {data.verticals.map((v) => {
        const isOpen = open.has(v.verticalId);
        return (
          <section key={v.verticalId}>
            <button
              type="button"
              onClick={() => toggle(v.verticalId)}
              aria-expanded={isOpen}
              className="flex w-full flex-wrap items-center gap-x-6 gap-y-1 px-4 py-3 text-left hover:bg-surface-sunk/40 sm:px-5"
            >
              <span className={clsx("text-[9px] text-ink-faint transition-transform", isOpen && "rotate-90")}>▶</span>
              <span className="min-w-[10rem] text-[14px] font-semibold text-ink">{v.label}</span>
              <span className="text-[12px] text-ink-muted">
                Receivables <span className="num font-medium text-ink">{money(v.total)}</span>{" "}
                <span className="text-ink-faint">({percent(v.pctOfEntity * 100, 1)} of the entity)</span>
              </span>
              <span className="text-[12px] text-ink-muted">
                91–180 days{" "}
                <span className={clsx("num font-medium", v.over90Total > 0 ? "text-caution" : "text-ink")}>
                  {money(v.over90Total)}
                </span>{" "}
                <span className="text-ink-faint">· {v.over90.length} customer{v.over90.length === 1 ? "" : "s"}</span>
              </span>
              <span className="text-[12px] text-ink-muted">
                Over 180 days{" "}
                <span className={clsx("num font-medium", v.over180Total > 0 ? "text-caution" : "text-ink")}>
                  {money(v.over180Total)}
                </span>{" "}
                <span className="text-ink-faint">· {v.over180.length} customer{v.over180.length === 1 ? "" : "s"}</span>
              </span>
            </button>
            {isOpen && <VerticalBlock v={v} weekEnd={data.weekEnd} canCommit={canCommit} />}
          </section>
        );
      })}
    </div>
  );
}

function VerticalBlock({
  v,
  weekEnd,
  canCommit,
}: {
  v: VerticalReceivables;
  weekEnd: string;
  canCommit: boolean;
}) {
  return (
    <div className="space-y-6 bg-surface-sunk/20 px-4 pb-5 pt-1 sm:px-5">
      {/* 1. the two ageing buckets: 91-180 days, then over 180 */}
      {(
        [
          { key: "over90", title: "Receivables over 90 days, up to 180", head: "91–180 days", none: "Nothing is between 90 and 180 days for this vertical.", lines: v.over90 },
          { key: "over180", title: "Receivables over 180 days", head: "Over 180 days", none: "Nothing is over 180 days for this vertical.", lines: v.over180 },
        ] as const
      ).map((b) => (
        <div key={b.key}>
          <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-muted">{b.title}</h3>
          {b.lines.length === 0 ? (
            <p className="text-[12.5px] text-ink-muted">{b.none}</p>
          ) : (
            <div className="table-frame">
              <table className="w-full border-collapse text-[12.5px]">
                <thead>
                  <tr>
                    <th className={clsx(th, "text-left")}>Customer</th>
                    <th className={clsx(th, "text-right")}>{b.head}</th>
                    <th className={clsx(th, "text-left")}>Commitment for this week</th>
                    <th className={clsx(th, "text-left")}>Earlier commitments</th>
                    <th className={clsx(th, "text-left")}>Review &amp; follow-up</th>
                    <th className={th} />
                  </tr>
                </thead>
                <tbody>
                  {b.lines.map((c) => (
                    <Over180Row
                      key={c.customer}
                      c={c}
                      verticalId={v.verticalId}
                      weekEnd={weekEnd}
                      canCommit={canCommit}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}

      {/* 2. top ten */}
      <div>
        <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
          Top 10 customers by receivables
        </h3>
        <div className="table-frame">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                <th className={clsx(th, "text-right")}>#</th>
                <th className={clsx(th, "text-left")}>Customer</th>
                <th className={clsx(th, "text-right")}>Outstanding</th>
                <th className={clsx(th, "text-right")}>% of vertical&rsquo;s receivables</th>
                <th className={clsx(th, "text-right")}>% of entity&rsquo;s receivables</th>
                <th className={clsx(th, "text-right")}>91–180 days</th>
                <th className={clsx(th, "text-right")}>Over 180 days</th>
              </tr>
            </thead>
            <tbody>
              {v.top.map((t) => (
                <TopRow key={t.customer} t={t} />
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold text-ink">
                <td className="border-t border-line-strong px-3 py-2" />
                <td className="border-t border-line-strong px-3 py-2">Top {v.top.length}</td>
                <td className="num border-t border-line-strong px-3 py-2 text-right">
                  {money(v.top.reduce((s, t) => s + t.outstanding, 0))}
                </td>
                <td className="num border-t border-line-strong px-3 py-2 text-right">
                  {percent(v.top.reduce((s, t) => s + t.pctOfVertical, 0) * 100, 1)}
                </td>
                <td className="num border-t border-line-strong px-3 py-2 text-right">
                  {percent(v.top.reduce((s, t) => s + t.pctOfEntity, 0) * 100, 1)}
                </td>
                <td className="border-t border-line-strong px-3 py-2" />
                <td className="border-t border-line-strong px-3 py-2" />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

    </div>
  );
}

/** One customer in an ageing bucket (91-180 days, or over 180): this week's commitment, and the review of last week's. */
function Over180Row({
  c,
  verticalId,
  weekEnd,
  canCommit,
}: {
  c: Over180Customer;
  verticalId: number;
  weekEnd: string;
  canCommit: boolean;
}) {
  const router = useRouter();
  const [showInvoices, setShowInvoices] = useState(false);
  const [commitment, setCommitment] = useState(c.commitment ?? "");
  const [review, setReview] = useState(c.previous?.review ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const canEditCommitment = canCommit && !c.locked;

  const onSave = async () => {
    setBusy(true);
    setMessage(null);
    let error: string | null = null;
    if (canEditCommitment && commitment.trim() !== (c.commitment ?? "")) {
      error = await save({ action: "commitment", bucket: c.bucket, verticalId, weekEnd, customer: c.customer, text: commitment });
    }
    if (!error && c.previous && canCommit) {
      if (review.trim() !== (c.previous.review ?? "")) {
        error = await save({
          action: "review",
          // the review belongs to the bucket the latest commitment was made in
          bucket: c.previous.bucket,
          verticalId,
          weekEnd: c.previous.weekEnd,
          customer: c.customer,
          review,
        });
      }
    }
    setBusy(false);
    setMessage(error ? { text: error, ok: false } : { text: "Saved", ok: true });
    if (!error) router.refresh();
  };

  return (
    <Fragment>
      <tr className="align-top hover:bg-surface-sunk/40">
        <td className={clsx(td, "text-ink")}>
          <button
            type="button"
            onClick={() => setShowInvoices((s) => !s)}
            aria-expanded={showInvoices}
            className="flex items-start gap-1.5 text-left hover:text-navy"
          >
            <span className={clsx("mt-[3px] text-[9px] text-ink-faint transition-transform", showInvoices && "rotate-90")}>▶</span>
            <span>
              {c.customer}
              <span className="ml-2 text-[11px] text-ink-faint">
                {c.invoices.length} invoice{c.invoices.length === 1 ? "" : "s"}
              </span>
            </span>
          </button>
        </td>
        <td className={clsx(td, "num text-right font-medium text-caution")}>{money(c.amount)}</td>
        <td className={clsx(td, "min-w-[10rem]")}>
          {canEditCommitment ? (
            <textarea
              value={commitment}
              onChange={(e) => setCommitment(e.target.value)}
              rows={2}
              placeholder="What is committed this week"
              className={field}
            />
          ) : (
            <span className="whitespace-pre-wrap text-ink">
              {c.commitment ?? <span className="text-ink-faint">—</span>}
              {c.locked && <span className="ml-1 text-[10.5px] uppercase tracking-[0.08em] text-ink-faint">frozen</span>}
            </span>
          )}
          {canEditCommitment && (
            <span className="mt-0.5 block text-[10.5px] text-ink-faint">Editable until the end of today.</span>
          )}
        </td>
        <td className={clsx(td, "min-w-[10rem] text-ink-muted")}>
          {c.history.length > 0 ? (
            <ul className="space-y-2">
              {c.history.map((h, n) => (
                <li key={h.weekEnd + h.bucket}>
                  <span className="block text-[10.5px] text-ink-faint">
                    Week ended {dateLabel(h.weekEnd)}
                    {h.bucket !== c.bucket && ` · made at ${h.bucket === "over90" ? "91–180 days" : "over 180 days"}`}
                  </span>
                  <span className="whitespace-pre-wrap">{h.commitment ?? "—"}</span>
                  {/* the latest one's review is the box to the right; the older ones' stand as written */}
                  {n > 0 && h.review && (
                    <span className="mt-0.5 block whitespace-pre-wrap text-[11.5px] text-ink-faint">
                      Review: {h.review}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-ink-faint">—</span>
          )}
        </td>
        <td className={clsx(td, "min-w-[10rem]")}>
          {c.previous ? (
            <>
              <span className="mb-0.5 block text-[10.5px] text-ink-faint">
                On the commitment of the week ended {dateLabel(c.previous.weekEnd)}
              </span>
              {canCommit ? (
                <textarea
                  value={review}
                  onChange={(e) => setReview(e.target.value)}
                  rows={2}
                  placeholder="Review of the latest commitment, and the follow-up"
                  className={field}
                />
              ) : (
                <span className="whitespace-pre-wrap text-ink">{c.previous.review ?? "—"}</span>
              )}
            </>
          ) : (
            <span className="text-ink-faint">Nothing committed earlier</span>
          )}
        </td>
        <td className={clsx(td, "whitespace-nowrap text-right")}>
          {canCommit && (
            <button
              type="button"
              onClick={onSave}
              disabled={busy}
              className="rounded-md border border-line px-2.5 py-1 text-[11.5px] font-medium text-ink-muted hover:bg-surface-sunk disabled:opacity-60"
            >
              {busy ? "Saving…" : "Save"}
            </button>
          )}
          {message && (
            <span className={clsx("mt-0.5 block text-[10.5px]", message.ok ? "text-positive" : "text-negative")}>
              {message.text}
            </span>
          )}
        </td>
      </tr>
      {showInvoices && (
        <tr>
          <td colSpan={6} className="border-b border-line bg-surface-sunk/30 px-6 py-2">
            <table className="w-full max-w-3xl border-collapse text-[12px]">
              <thead>
                <tr className="text-ink-faint">
                  <th className="px-1 py-1 text-left font-medium">Invoice</th>
                  <th className="px-1 py-1 text-left font-medium">Date</th>
                  <th className="px-1 py-1 text-left font-medium">Due</th>
                  <th className="px-1 py-1 text-right font-medium">Balance</th>
                  <th className="px-1 py-1 text-right font-medium">Days overdue</th>
                </tr>
              </thead>
              <tbody>
                {c.invoices.map((i) => (
                  <tr key={i.invoiceNumber + (i.invoiceDate ?? "")}>
                    <td className="border-t border-line px-1 py-1.5 text-ink">{i.invoiceNumber}</td>
                    <td className="border-t border-line px-1 py-1.5 text-ink-muted">{i.invoiceDate ? dateLabel(i.invoiceDate) : "—"}</td>
                    <td className="border-t border-line px-1 py-1.5 text-ink-muted">{i.dueDate ? dateLabel(i.dueDate) : "—"}</td>
                    <td className="num border-t border-line px-1 py-1.5 text-right">{money(i.balance)}</td>
                    <td className="num border-t border-line px-1 py-1.5 text-right text-caution">{i.ageDays}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

/** One of the ten largest customers; opens to the invoices that make up its balance. */
function TopRow({ t }: { t: TopCustomer }) {
  const [open, setOpen] = useState(false);
  return (
    <Fragment>
      <tr className="hover:bg-surface-sunk/40">
        <td className={clsx(td, "num text-right text-ink-faint")}>{t.rank}</td>
        <td className={clsx(td, "text-ink")}>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="flex items-center gap-2 text-left hover:text-navy"
          >
            <span className={clsx("text-[9px] text-ink-faint transition-transform", open && "rotate-90")}>▶</span>
            {t.customer}
            <span className="text-[11px] text-ink-faint">
              {t.invoices.length} invoice{t.invoices.length === 1 ? "" : "s"}
            </span>
          </button>
        </td>
        <td className={clsx(td, "num text-right text-ink")}>{money(t.outstanding)}</td>
        <td className={clsx(td, "num text-right text-ink-muted")}>{percent(t.pctOfVertical * 100, 1)}</td>
        <td className={clsx(td, "num text-right text-ink-muted")}>{percent(t.pctOfEntity * 100, 1)}</td>
        <td className={clsx(td, "num text-right", t.over90 > 0 ? "text-caution" : "text-ink-faint")}>
          {t.over90 > 0 ? money(t.over90) : "—"}
        </td>
        <td className={clsx(td, "num text-right", t.over180 > 0 ? "text-caution" : "text-ink-faint")}>
          {t.over180 > 0 ? money(t.over180) : "—"}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={7} className="border-b border-line bg-surface-sunk/30 px-6 py-2">
            <table className="w-full max-w-3xl border-collapse text-[12px]">
              <thead>
                <tr className="text-ink-faint">
                  <th className="px-1 py-1 text-left font-medium">Invoice</th>
                  <th className="px-1 py-1 text-left font-medium">Date</th>
                  <th className="px-1 py-1 text-left font-medium">Due</th>
                  <th className="px-1 py-1 text-right font-medium">Balance</th>
                  <th className="px-1 py-1 text-right font-medium">Days overdue</th>
                </tr>
              </thead>
              <tbody>
                {t.invoices.map((i) => (
                  <tr key={i.invoiceNumber + (i.invoiceDate ?? "") + i.balance}>
                    <td className="border-t border-line px-1 py-1.5 text-ink">{i.invoiceNumber}</td>
                    <td className="border-t border-line px-1 py-1.5 text-ink-muted">{i.invoiceDate ? dateLabel(i.invoiceDate) : "—"}</td>
                    <td className="border-t border-line px-1 py-1.5 text-ink-muted">{i.dueDate ? dateLabel(i.dueDate) : "—"}</td>
                    <td className="num border-t border-line px-1 py-1.5 text-right">{money(i.balance)}</td>
                    <td className={clsx("num border-t border-line px-1 py-1.5 text-right", i.ageDays > 180 ? "text-caution" : "text-ink-muted")}>
                      {i.ageDays > 0 ? i.ageDays : "not due"}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold text-ink">
                  <td className="border-t border-line-strong px-1 py-1.5" colSpan={3}>Total</td>
                  <td className="num border-t border-line-strong px-1 py-1.5 text-right">{money(t.invoices.reduce((s, i) => s + i.balance, 0))}</td>
                  <td className="border-t border-line-strong px-1 py-1.5" />
                </tr>
              </tfoot>
            </table>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

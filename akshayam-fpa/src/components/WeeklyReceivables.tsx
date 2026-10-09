"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { dateLabel, money, percent } from "@/lib/format";
import type {
  Over180Customer,
  TdsCustomer,
  TdsReflected,
  VerticalReceivables,
  WeeklyReceivablesResult,
} from "@/lib/reports/weekly-receivables";

/**
 * The MAK meeting's Receivables tab: for each vertical, the receivables over
 * 180 days with what is committed for the week and how last week's commitment
 * went; the ten customers who owe the most; and every customer's invoices with
 * the TDS Zoho books on them against what Form 26AS shows.
 *
 * What is typed here is the head's own account: a commitment (editable until
 * the end of the day it was first keyed), a review of last week's with whether
 * it was achieved, and the follow-up on a TDS difference. The figures are read
 * fresh from the receivables snapshot, the ledger and Form 26AS.
 */

const th =
  "border-y border-line px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-faint";
const td = "border-b border-line px-3 py-2";
const field =
  "w-full rounded-md border border-line bg-surface px-2 py-1 text-[12px] text-ink placeholder:text-ink-faint";

const REFLECTED: Record<TdsReflected, { label: string; tone: string }> = {
  yes: { label: "Yes", tone: "bg-positive-tint text-positive" },
  partly: { label: "Partly", tone: "bg-caution-tint text-caution" },
  no: { label: "No", tone: "bg-negative-tint text-negative" },
  na: { label: "No TDS booked", tone: "bg-surface-sunk text-ink-faint" },
};

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
              <span className="min-w-[14rem] text-[14px] font-semibold text-ink">{v.label}</span>
              <span className="text-[12px] text-ink-muted">
                Receivables <span className="num font-medium text-ink">{money(v.total)}</span>{" "}
                <span className="text-ink-faint">({percent(v.pctOfEntity * 100, 1)} of the entity)</span>
              </span>
              <span className="text-[12px] text-ink-muted">
                Over 180 days{" "}
                <span className={clsx("num font-medium", v.over180Total > 0 ? "text-caution" : "text-ink")}>
                  {money(v.over180Total)}
                </span>{" "}
                <span className="text-ink-faint">· {v.over180.length} customer{v.over180.length === 1 ? "" : "s"}</span>
              </span>
            </button>
            {isOpen && <VerticalBlock v={v} weekEnd={data.weekEnd} canCommit={canCommit} tdsFrom={data.tdsFrom} />}
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
  tdsFrom,
}: {
  v: VerticalReceivables;
  weekEnd: string;
  canCommit: boolean;
  tdsFrom: string;
}) {
  return (
    <div className="space-y-6 bg-surface-sunk/20 px-4 pb-5 pt-1 sm:px-5">
      {/* 1. over 180 days */}
      <div>
        <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
          Receivables over 180 days
        </h3>
        {v.over180.length === 0 ? (
          <p className="text-[12.5px] text-ink-muted">Nothing is over 180 days for this vertical.</p>
        ) : (
          <div className="table-frame">
            <table className="w-full min-w-max border-collapse text-[12.5px]">
              <thead>
                <tr>
                  <th className={clsx(th, "text-left")}>Customer</th>
                  <th className={clsx(th, "text-right")}>Over 180 days</th>
                  <th className={clsx(th, "text-left")}>Commitment for this week</th>
                  <th className={clsx(th, "text-left")}>Last week&rsquo;s commitment</th>
                  <th className={clsx(th, "text-left")}>Review &amp; follow-up</th>
                  <th className={clsx(th, "text-left")}>Achieved?</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody>
                {v.over180.map((c) => (
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

      {/* 2. top ten */}
      <div>
        <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
          Top 10 customers by receivables
        </h3>
        <div className="table-frame">
          <table className="w-full min-w-max border-collapse text-[12.5px]">
            <thead>
              <tr>
                <th className={clsx(th, "text-right")}>#</th>
                <th className={clsx(th, "text-left")}>Customer</th>
                <th className={clsx(th, "text-right")}>Outstanding</th>
                <th className={clsx(th, "text-right")}>% of vertical&rsquo;s receivables</th>
                <th className={clsx(th, "text-right")}>% of entity&rsquo;s receivables</th>
                <th className={clsx(th, "text-right")}>Over 180 days</th>
              </tr>
            </thead>
            <tbody>
              {v.top.map((t) => (
                <tr key={t.customer} className="hover:bg-surface-sunk/40">
                  <td className={clsx(td, "num text-right text-ink-faint")}>{t.rank}</td>
                  <td className={clsx(td, "text-ink")}>{t.customer}</td>
                  <td className={clsx(td, "num text-right text-ink")}>{money(t.outstanding)}</td>
                  <td className={clsx(td, "num text-right text-ink-muted")}>{percent(t.pctOfVertical * 100, 1)}</td>
                  <td className={clsx(td, "num text-right text-ink-muted")}>{percent(t.pctOfEntity * 100, 1)}</td>
                  <td className={clsx(td, "num text-right", t.over180 > 0 ? "text-caution" : "text-ink-faint")}>
                    {t.over180 > 0 ? money(t.over180) : "—"}
                  </td>
                </tr>
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
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* 3. TDS */}
      <div>
        <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
          Invoices and TDS - Zoho against Form 26AS
        </h3>
        <p className="mb-2 text-[11.5px] text-ink-muted">
          Invoices raised from {dateLabel(tdsFrom)} to the week&rsquo;s end, with the TDS receivable Zoho books on
          each. Form 26AS records tax deducted by customer and quarter, not by invoice, so it is compared with the
          customer&rsquo;s total over the same stretch. Open a customer for its invoices.
          {v.tdsNoReceivable > 0 && (
            <>
              {" "}
              <span className="font-medium text-ink">
                {v.tdsNoReceivable} customer{v.tdsNoReceivable === 1 ? "" : "s"} below owe nothing now
              </span>{" "}
              but have TDS to be claimed; they are listed too.
            </>
          )}
        </p>
        <div className="table-frame">
          <table className="w-full min-w-max border-collapse text-[12.5px]">
            <thead>
              <tr>
                <th className={clsx(th, "text-left")}>Customer</th>
                <th className={clsx(th, "text-right")}>Outstanding</th>
                <th className={clsx(th, "text-right")}>TDS per Zoho</th>
                <th className={clsx(th, "text-right")}>TDS per Form 26AS</th>
                <th className={clsx(th, "text-right")}>Difference</th>
                <th className={clsx(th, "text-center")}>Reflected in 26AS?</th>
                <th className={clsx(th, "text-left")}>Follow-up action</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {v.tds.map((c) => (
                <TdsRow key={c.customer} c={c} verticalId={v.verticalId} weekEnd={weekEnd} canCommit={canCommit} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/** One customer over 180 days: this week's commitment, and the review of last week's. */
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
  const [achieved, setAchieved] = useState<string>(c.previous?.achieved ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const canEditCommitment = canCommit && !c.locked;

  const onSave = async () => {
    setBusy(true);
    setMessage(null);
    let error: string | null = null;
    if (canEditCommitment && commitment.trim() !== (c.commitment ?? "")) {
      error = await save({ action: "commitment", verticalId, weekEnd, customer: c.customer, text: commitment });
    }
    if (!error && c.previous && canCommit) {
      const changed =
        review.trim() !== (c.previous.review ?? "") || achieved !== (c.previous.achieved ?? "");
      if (changed) {
        error = await save({
          action: "review",
          verticalId,
          weekEnd: c.previous.weekEnd,
          customer: c.customer,
          review,
          achieved: achieved || null,
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
        <td className={clsx(td, "min-w-[14rem]")}>
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
        <td className={clsx(td, "min-w-[12rem] text-ink-muted")}>
          {c.previous ? (
            <>
              <span className="block text-[10.5px] text-ink-faint">Week ended {dateLabel(c.previous.weekEnd)}</span>
              <span className="whitespace-pre-wrap">{c.previous.commitment ?? "—"}</span>
            </>
          ) : (
            <span className="text-ink-faint">—</span>
          )}
        </td>
        <td className={clsx(td, "min-w-[14rem]")}>
          {c.previous ? (
            canCommit ? (
              <textarea
                value={review}
                onChange={(e) => setReview(e.target.value)}
                rows={2}
                placeholder="Review of last week's commitment, and the follow-up"
                className={field}
              />
            ) : (
              <span className="whitespace-pre-wrap text-ink">{c.previous.review ?? "—"}</span>
            )
          ) : (
            <span className="text-ink-faint">Nothing committed earlier</span>
          )}
        </td>
        <td className={td}>
          {c.previous ? (
            canCommit ? (
              <select value={achieved} onChange={(e) => setAchieved(e.target.value)} className={clsx(field, "w-28")}>
                <option value="">—</option>
                <option value="yes">Yes</option>
                <option value="partly">Partly</option>
                <option value="no">No</option>
              </select>
            ) : (
              <span className="text-ink">{c.previous.achieved ?? "—"}</span>
            )
          ) : (
            <span className="text-ink-faint">—</span>
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

/** One customer's TDS: the invoices behind it, Zoho against Form 26AS, and the follow-up. */
function TdsRow({
  c,
  verticalId,
  weekEnd,
  canCommit,
}: {
  c: TdsCustomer;
  verticalId: number;
  weekEnd: string;
  canCommit: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [remark, setRemark] = useState(c.remark ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const onSave = async () => {
    setBusy(true);
    setMessage(null);
    const error = await save({ action: "tds", verticalId, weekEnd, customer: c.customer, remark });
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
            onClick={() => setOpen((s) => !s)}
            aria-expanded={open}
            className="flex items-start gap-1.5 text-left hover:text-navy"
          >
            <span className={clsx("mt-[3px] text-[9px] text-ink-faint transition-transform", open && "rotate-90")}>▶</span>
            <span>
              {c.customer}
              <span className="ml-2 text-[11px] text-ink-faint">
                {c.invoices.length} invoice{c.invoices.length === 1 ? "" : "s"}
              </span>
            </span>
          </button>
        </td>
        <td className={clsx(td, "num text-right text-ink-muted")}>
          {c.outstanding >= 1 ? (
            money(c.outstanding)
          ) : (
            <span className="rounded-full bg-surface-sunk px-2 py-0.5 text-[10.5px] font-medium text-ink-muted">
              no receivable
            </span>
          )}
        </td>
        <td className={clsx(td, "num text-right text-ink")}>{c.tdsZoho ? money(c.tdsZoho) : "—"}</td>
        <td className={clsx(td, "num text-right text-ink")}>{c.tds26as ? money(c.tds26as) : "—"}</td>
        <td className={clsx(td, "num text-right", Math.abs(c.difference) >= 1 ? "font-medium text-negative" : "text-ink-faint")}>
          {Math.abs(c.difference) >= 1 ? (c.difference < 0 ? `(${money(c.difference)})` : money(c.difference)) : "—"}
        </td>
        <td className={clsx(td, "text-center")}>
          <span
            className={clsx(
              "inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
              REFLECTED[c.reflected].tone,
            )}
          >
            {REFLECTED[c.reflected].label}
          </span>
        </td>
        <td className={clsx(td, "min-w-[14rem]")}>
          {canCommit ? (
            <textarea
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              rows={2}
              placeholder="Follow-up action"
              className={field}
            />
          ) : (
            <span className="whitespace-pre-wrap text-ink">{c.remark ?? "—"}</span>
          )}
          {c.remarkWeekEnd && c.remarkWeekEnd !== weekEnd && (
            <span className="mt-0.5 block text-[10.5px] text-ink-faint">Last noted for the week ended {dateLabel(c.remarkWeekEnd)}.</span>
          )}
        </td>
        <td className={clsx(td, "whitespace-nowrap text-right")}>
          {canCommit && (
            <button
              type="button"
              onClick={onSave}
              disabled={busy || remark.trim() === (c.remark ?? "")}
              className="rounded-md border border-line px-2.5 py-1 text-[11.5px] font-medium text-ink-muted hover:bg-surface-sunk disabled:opacity-50"
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
      {open && (
        <tr>
          <td colSpan={8} className="border-b border-line bg-surface-sunk/30 px-6 py-2">
            {c.invoices.length === 0 ? (
              <p className="text-[12px] text-ink-muted">No invoice has been raised on this customer this financial year.</p>
            ) : (
              <table className="w-full max-w-3xl border-collapse text-[12px]">
                <thead>
                  <tr className="text-ink-faint">
                    <th className="px-1 py-1 text-left font-medium">Invoice</th>
                    <th className="px-1 py-1 text-left font-medium">Date</th>
                    <th className="px-1 py-1 text-right font-medium">Invoice value (ex tax)</th>
                    <th className="px-1 py-1 text-right font-medium">TDS per Zoho</th>
                  </tr>
                </thead>
                <tbody>
                  {c.invoices.map((i) => (
                    <tr key={i.invoiceNumber}>
                      <td className="border-t border-line px-1 py-1.5 text-ink">{i.invoiceNumber}</td>
                      <td className="border-t border-line px-1 py-1.5 text-ink-muted">{i.invoiceDate ? dateLabel(i.invoiceDate) : "—"}</td>
                      <td className="num border-t border-line px-1 py-1.5 text-right">{money(i.amount)}</td>
                      <td className="num border-t border-line px-1 py-1.5 text-right">{i.tdsZoho ? money(i.tdsZoho) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-semibold text-ink">
                    <td className="border-t border-line-strong px-1 py-1.5" colSpan={2}>Total</td>
                    <td className="num border-t border-line-strong px-1 py-1.5 text-right">{money(c.invoices.reduce((s, i) => s + i.amount, 0))}</td>
                    <td className="num border-t border-line-strong px-1 py-1.5 text-right">{money(c.tdsZoho)}</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </td>
        </tr>
      )}
    </Fragment>
  );
}

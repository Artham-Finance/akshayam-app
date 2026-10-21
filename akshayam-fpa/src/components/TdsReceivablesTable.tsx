"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { dateLabel, money, moneySigned } from "@/lib/format";
import { tdsOnInvoice } from "@/lib/tds-invoice";
import type {
  TdsInvoiceCustomer,
  TdsInvoiceQuarter,
  TdsInvoiceRow,
  TdsInvoiceYear,
  TdsReceivableRow,
  TdsReceivablesResult,
} from "@/lib/reports/tds-receivables";

/**
 * The MAK meeting's TDS receivables tab: the TDS held as receivable from customers,
 * a table for each financial year. Year, vertical, customer and the TDS amount are
 * read-only; the invoice (number, date, value - free text), the observation and the
 * follow-up action are the vertical head's to key. The 10% of the invoice value fills
 * in as the value is typed.
 *
 * After the last of those years comes the current year, invoice by invoice and quarter
 * by quarter, with the amount Form 26AS shows and the difference from the TDS booked.
 */

const th =
  "border-y border-line px-2 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-faint";
const td = "border-b border-line px-2 py-2 align-top";
const field =
  "w-full rounded-md border border-line bg-surface px-2 py-1 text-[12px] text-ink placeholder:text-ink-faint";

export function TdsReceivablesTable({
  data,
  canCommit,
}: {
  data: TdsReceivablesResult;
  canCommit: boolean;
}) {
  return (
    <div className="divide-y divide-line">
      <Summary data={data} />
      {data.years.length === 0 && (
        <p className="px-4 py-6 text-[13px] text-ink-muted sm:px-5">
          No TDS receivable is on file for the verticals in this view.
        </p>
      )}
      {data.years.map((y) => (
        <section key={y.fy}>
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 px-4 py-3 sm:px-5">
            <h3 className="text-[14px] font-semibold text-ink">{y.fy}</h3>
            <span className="text-[12px] text-ink-muted">
              {customerCount(y.rows)} customer{customerCount(y.rows) === 1 ? "" : "s"}
            </span>
            <span className="text-[12px] text-ink-muted">
              TDS receivable <span className="num font-medium text-ink">{money(y.total)}</span>
            </span>
          </div>
          <div className="table-frame">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr>
                  <th className={clsx(th, "text-left")}>Year</th>
                  <th className={clsx(th, "text-left")}>Vertical</th>
                  <th className={clsx(th, "text-left")}>Customer</th>
                  <th className={clsx(th, "text-right")}>TDS amount</th>
                  <th className={clsx(th, "text-left")}>Invoice</th>
                  <th className={clsx(th, "text-left")}>Observation</th>
                  <th className={clsx(th, "text-left")}>Follow-up action</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody>
                {y.rows.map((r) => (
                  <TdsRow key={r.id} row={r} canCommit={canCommit} />
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold text-ink">
                  <td className="border-t border-line-strong px-3 py-2" colSpan={3}>
                    Total {y.fy}
                  </td>
                  <td className="num border-t border-line-strong px-3 py-2 text-right">{money(y.total)}</td>
                  <td className="border-t border-line-strong px-3 py-2" colSpan={4} />
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      ))}
      {data.years.length > 1 && (
        <p className="px-4 py-3 text-[12.5px] text-ink-muted sm:px-5">
          All years above: TDS receivable <span className="num font-semibold text-ink">{money(data.total)}</span>
        </p>
      )}
      <InvoiceYear year={data.invoices} canCommit={canCommit} />
    </div>
  );
}

/** How many different customers a year's rows name - a customer can appear on more than one row. */
const customerCount = (rows: { customer: string }[]) =>
  new Set(rows.map((r) => r.customer.trim().toLowerCase())).size;

/** "FY26-27" for the year that starts in 2026. */
const shortYear = (start: number) => `FY${String(start).slice(2)}-${String(start + 1).slice(2)}`;

/**
 * The tab at a glance: each sheet year, then each quarter of the current year, with its customers,
 * the TDS, and how much of it Form 26AS reflects. The sheet years are the TDS booked that the
 * customer has not shown in Form 26AS, so nothing of them is reflected; a quarter's figure is
 * what Form 26AS shows for the customers with TDS booked in it, as in the list below.
 */
function Summary({ data }: { data: TdsReceivablesResult }) {
  const year = data.invoices;
  const lines = [
    ...data.years.map((y) => ({
      label: y.fy,
      customers: customerCount(y.rows) as number | null,
      tds: y.total as number | null,
      reflected: 0 as number | null,
      note: "",
    })),
    ...([1, 2, 3, 4] as const).map((n) => {
      const q = year.quarters.find((x) => x.quarter === n);
      return {
        label: `${shortYear(year.fyStartYear)} (Q${n})`,
        customers: q ? q.customers.length : null,
        tds: q ? q.tds : null,
        reflected: q ? q.form26as : null,
        note: q ? (q.has26as ? "" : "Form 26AS not uploaded") : "not begun",
      };
    }),
  ];
  return (
    <section className="px-4 py-3 sm:px-5">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-muted">Summary</h3>
      <div className="table-frame">
        <table className="w-full max-w-3xl border-collapse text-[12.5px]">
          <thead>
            <tr>
              <th className={clsx(th, "text-left")}>Year</th>
              <th className={clsx(th, "text-right")}>Number of customers</th>
              <th className={clsx(th, "text-right")}>TDS amount</th>
              <th className={clsx(th, "text-right")}>Reflected in Form 26AS</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.label} className="hover:bg-surface-sunk/40">
                <td className="border-b border-line px-3 py-2 text-ink">
                  {l.label}
                  {l.note && <span className="ml-2 text-[10.5px] text-ink-faint">{l.note}</span>}
                </td>
                <td className="num border-b border-line px-3 py-2 text-right text-ink">
                  {l.customers === null ? <span className="text-ink-faint">—</span> : l.customers}
                </td>
                <td className="num border-b border-line px-3 py-2 text-right text-ink">
                  {l.tds === null ? <span className="text-ink-faint">—</span> : moneySigned(l.tds)}
                </td>
                <td className="num border-b border-line px-3 py-2 text-right text-ink">
                  {l.reflected === null ? <span className="text-ink-faint">—</span> : l.reflected ? money(l.reflected) : "Nil"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1.5 text-[11px] text-ink-faint">
        FY23-24 to FY25-26 are the TDS booked that the customer has not shown in Form 26AS, so none of it is
        reflected. For each quarter of {shortYear(year.fyStartYear)}, TDS is what Zoho booked in the quarter.
      </p>

      <h3 className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
        Summary — vertical wise
      </h3>
      <VerticalSummary data={data} />
    </section>
  );
}

/** The same summary, a vertical at a time; only the periods in which the vertical has TDS are listed. */
function VerticalSummary({ data }: { data: TdsReceivablesResult }) {
  const year = data.invoices;
  interface Period {
    label: string;
    customers: Set<string>;
    tds: number;
    reflected: number;
  }
  const verticals = new Map<string, { name: string; periods: Period[] }>();
  const periodFor = (verticalId: number | null, name: string, label: string) => {
    const key = String(verticalId ?? "none");
    const v = verticals.get(key) ?? { name, periods: [] };
    verticals.set(key, v);
    let p = v.periods.find((x) => x.label === label);
    if (!p) {
      p = { label, customers: new Set(), tds: 0, reflected: 0 };
      v.periods.push(p);
    }
    return p;
  };

  for (const y of data.years) {
    for (const r of y.rows) {
      const p = periodFor(r.verticalId, r.vertical, y.fy);
      p.customers.add(r.customer.trim().toLowerCase());
      p.tds += r.tdsAmount;
    }
  }
  for (const q of year.quarters) {
    const label = `${shortYear(year.fyStartYear)} (Q${q.quarter})`;
    for (const c of q.customers) {
      // Form 26AS is one figure for the customer and quarter: it goes to the vertical that
      // carries most of the customer's TDS, as the reconciliation does, so the verticals add up.
      const lead = c.invoices.reduce((a, b) => (b.tds > a.tds ? b : a), c.invoices[0]);
      for (const i of c.invoices) {
        const p = periodFor(i.verticalId, i.vertical, label);
        p.customers.add(c.customer.trim().toLowerCase());
        p.tds += i.tds;
        if (i === lead) p.reflected += c.form26as;
      }
    }
  }

  const order = (v: { periods: Period[] }) => v.periods.reduce((s, p) => s + p.tds, 0);
  const list = [...verticals.values()].sort((a, b) => order(b) - order(a));
  if (list.length === 0) return <p className="text-[12.5px] text-ink-muted">Nothing to show for this view.</p>;

  return (
    <div className="table-frame">
      <table className="w-full max-w-3xl border-collapse text-[12.5px]">
        <thead>
          <tr>
            <th className={clsx(th, "text-left")}>Vertical</th>
            <th className={clsx(th, "text-left")}>Year</th>
            <th className={clsx(th, "text-right")}>Number of customers</th>
            <th className={clsx(th, "text-right")}>TDS amount</th>
            <th className={clsx(th, "text-right")}>Reflected in Form 26AS</th>
          </tr>
        </thead>
        <tbody>
          {list.map((v) =>
            v.periods.map((p, n) => (
              <tr key={`${v.name}|${p.label}`} className={clsx("hover:bg-surface-sunk/40", n === 0 && "border-t border-line-strong")}>
                <td className="border-b border-line px-3 py-2 font-medium text-ink">{n === 0 ? v.name : ""}</td>
                <td className="border-b border-line px-3 py-2 text-ink">{p.label}</td>
                <td className="num border-b border-line px-3 py-2 text-right text-ink">{p.customers.size}</td>
                <td className="num border-b border-line px-3 py-2 text-right text-ink">{moneySigned(p.tds)}</td>
                <td className="num border-b border-line px-3 py-2 text-right text-ink">
                  {p.reflected ? money(p.reflected) : "Nil"}
                </td>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </div>
  );
}

const rowKey = (c: TdsInvoiceCustomer, i: TdsInvoiceRow) => `${i.entityId}|${c.customer}|${i.invoiceNumber}|${i.verticalId ?? 0}`;

/** The current year's TDS, invoice by invoice, a quarter at a time. */
function InvoiceYear({ year, canCommit }: { year: TdsInvoiceYear; canCommit: boolean }) {
  return (
    <section>
      <div className="px-4 py-3 sm:px-5">
        <h3 className="text-[14px] font-semibold text-ink">{year.label} — invoice wise, quarter wise</h3>
        <p className="mt-1 text-[11.5px] text-ink-muted">
          The TDS booked in Zoho on each invoice, against what Form 26AS shows. Form 26AS records tax deducted by
          customer and quarter, not by invoice, so its amount is for the customer&rsquo;s whole quarter and is shown
          once beside that customer&rsquo;s invoices, as is the difference from the TDS booked on them.
        </p>
      </div>
      {year.quarters.length === 0 ? (
        <p className="px-4 pb-4 text-[12.5px] text-ink-muted sm:px-5">No quarter of {year.label} has begun yet.</p>
      ) : (
        year.quarters.map((q) => <InvoiceQuarter key={q.quarter} year={year} q={q} canCommit={canCommit} />)
      )}
    </section>
  );
}

function InvoiceQuarter({ year, q, canCommit }: { year: TdsInvoiceYear; q: TdsInvoiceQuarter; canCommit: boolean }) {
  const differs = Math.abs(q.difference) >= 1;
  return (
    <div className="border-t border-line">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 bg-surface-sunk/30 px-4 py-2.5 sm:px-5">
        <h4 className="text-[13px] font-semibold text-ink">{q.label}</h4>
        <span className="text-[12px] text-ink-muted">
          TDS <span className="num font-medium text-ink">{moneySigned(q.tds)}</span>
        </span>
        <span className="text-[12px] text-ink-muted">
          Found in Form 26AS <span className="num font-medium text-ink">{money(q.form26as)}</span>
        </span>
        <span className="text-[12px] text-ink-muted">
          Difference{" "}
          <span className={clsx("num font-medium", differs ? "text-negative" : "text-ink")}>{moneySigned(q.difference)}</span>
        </span>
        {!q.has26as && (
          <span className="rounded-full bg-caution-tint px-2 py-0.5 text-[10.5px] font-medium text-caution">
            Form 26AS not uploaded for this quarter
          </span>
        )}
      </div>
      {q.customers.length === 0 ? (
        <p className="px-4 py-3 text-[12.5px] text-ink-muted sm:px-5">No TDS was booked in this quarter.</p>
      ) : (
        <div className="table-frame">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                <th className={clsx(th, "text-left")}>Quarter</th>
                <th className={clsx(th, "text-left")}>Vertical</th>
                <th className={clsx(th, "text-left")}>Customer</th>
                <th className={clsx(th, "text-left")}>Invoice</th>
                <th className={clsx(th, "text-right")}>Amount found in Form 26AS</th>
                <th className={clsx(th, "text-right")}>Difference (TDS − Form 26AS)</th>
                <th className={clsx(th, "text-left")}>Observation</th>
                <th className={clsx(th, "text-left")}>Follow-up action</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {q.customers.map((c) =>
                c.invoices.map((i, n) => (
                  <InvoiceRow key={rowKey(c, i)} year={year} q={q} c={c} i={i} first={n === 0} canCommit={canCommit} />
                )),
              )}
            </tbody>
            <tfoot>
              <tr className="font-semibold text-ink">
                <td className="border-t border-line-strong px-3 py-2" colSpan={3}>
                  Total {q.label}
                </td>
                <td className="num border-t border-line-strong px-3 py-2">
                  {line("TDS", <span className="num">{moneySigned(q.tds)}</span>)}
                </td>
                <td className="num border-t border-line-strong px-3 py-2 text-right">{money(q.form26as)}</td>
                <td className={clsx("num border-t border-line-strong px-3 py-2 text-right", differs && "text-negative")}>
                  {moneySigned(q.difference)}
                </td>
                <td className="border-t border-line-strong px-3 py-2" colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {Math.abs(q.form26asOther) >= 1 && (
        <p className="px-4 py-2 text-[11.5px] text-ink-muted sm:px-5">
          Form 26AS also shows <span className="num font-medium text-ink">{money(q.form26asOther)}</span> for customers
          with no TDS booked in this quarter; it is on no row above.
        </p>
      )}
    </div>
  );
}

function InvoiceRow({
  year,
  q,
  c,
  i,
  first,
  canCommit,
}: {
  year: TdsInvoiceYear;
  q: TdsInvoiceQuarter;
  c: TdsInvoiceCustomer;
  i: TdsInvoiceRow;
  first: boolean;
  canCommit: boolean;
}) {
  const router = useRouter();
  const [observation, setObservation] = useState(i.observation ?? "");
  const [followUp, setFollowUp] = useState(i.followUp ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const dirty = observation.trim() !== (i.observation ?? "") || followUp.trim() !== (i.followUp ?? "");
  const differs = Math.abs(c.difference) >= 1;

  const onSave = async () => {
    setBusy(true);
    setMessage(null);
    let error: string | null = null;
    try {
      const response = await fetch("/api/tds-invoice-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fyStartYear: year.fyStartYear,
          quarter: q.quarter,
          customer: c.customer,
          invoiceNumber: i.invoiceNumber,
          verticalId: i.verticalId ?? 0,
          observation,
          followUp,
        }),
      });
      const payload = await response.json();
      if (!response.ok) error = payload.error ?? "Could not save.";
    } catch {
      error = "Could not reach the server.";
    }
    setBusy(false);
    setMessage(error ? { text: error, ok: false } : { text: "Saved", ok: true });
    if (!error) router.refresh();
  };

  const area = (value: string, set: (v: string) => void, placeholder: string) =>
    canCommit ? (
      <textarea value={value} onChange={(e) => set(e.target.value)} rows={4} placeholder={placeholder} className={field} />
    ) : (
      <span className="whitespace-pre-wrap text-ink">{value || <span className="text-ink-faint">—</span>}</span>
    );

  return (
    <tr className={clsx("hover:bg-surface-sunk/40", first && "border-t border-line")}>
      <td className={clsx(td, "text-ink-muted")}>Q{q.quarter}</td>
      <td className={clsx(td, "text-ink")}>{i.vertical}</td>
      <td className={clsx(td, "min-w-[9rem] text-ink")}>{c.customer}</td>
      <td className={clsx(td, "min-w-[12rem]")}>
        <div className="space-y-1">
          {line("Inv number", <span className="text-ink">{i.invoiceNumber || <span className="text-ink-faint">no invoice</span>}</span>)}
          {line("Inv date", <span className="text-ink-muted">{i.invoiceDate ? dateLabel(i.invoiceDate) : "—"}</span>)}
          {line("Inv amount", <span className="num text-ink">{i.invoiceAmount === null ? "—" : money(i.invoiceAmount, 2)}</span>)}
          {line("TDS amount", <span className="num font-medium text-ink">{moneySigned(i.tds, 2)}</span>)}
        </div>
      </td>
      {first && (
        <>
          <td rowSpan={c.invoices.length} className={clsx(td, "num border-l border-line text-right text-ink")}>
            {c.form26as ? money(c.form26as, 2) : "—"}
            {c.invoices.length > 1 && (
              <span className="block text-[10.5px] font-normal text-ink-faint">for the customer</span>
            )}
          </td>
          <td
            rowSpan={c.invoices.length}
            className={clsx(td, "num text-right", differs ? "font-medium text-negative" : "text-ink-faint")}
          >
            {differs ? moneySigned(c.difference, 2) : "—"}
            {c.invoices.length > 1 && (
              <span className="block text-[10.5px] font-normal text-ink-faint">on {moneySigned(c.tds, 2)} booked</span>
            )}
          </td>
        </>
      )}
      <td className={clsx(td, "min-w-[10rem]")}>{area(observation, setObservation, "Observation")}</td>
      <td className={clsx(td, "min-w-[10rem]")}>{area(followUp, setFollowUp, "Follow-up action")}</td>
      <td className={clsx(td, "whitespace-nowrap text-right")}>
        {canCommit && (
          <button
            type="button"
            onClick={onSave}
            disabled={busy || !dirty}
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
  );
}

/** One labelled line of a stacked cell: a small label, then its value or box. */
const line = (label: string, value: React.ReactNode) => (
  <div className="flex items-center gap-2">
    <span className="w-[4.5rem] shrink-0 text-[10.5px] text-ink-faint">{label}</span>
    <div className="min-w-0 flex-1">{value}</div>
  </div>
);

function TdsRow({ row, canCommit }: { row: TdsReceivableRow; canCommit: boolean }) {
  const router = useRouter();
  const [invNumber, setInvNumber] = useState(row.invNumber ?? "");
  const [invDate, setInvDate] = useState(row.invDate ?? "");
  const [invValue, setInvValue] = useState(row.invValue ?? "");
  const [observation, setObservation] = useState(row.observation ?? "");
  const [followUp, setFollowUp] = useState(row.followUp ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const dirty =
    invNumber.trim() !== (row.invNumber ?? "") ||
    invDate.trim() !== (row.invDate ?? "") ||
    invValue.trim() !== (row.invValue ?? "") ||
    observation.trim() !== (row.observation ?? "") ||
    followUp.trim() !== (row.followUp ?? "");
  const tenPercent = tdsOnInvoice(invValue);

  const onSave = async () => {
    setBusy(true);
    setMessage(null);
    let error: string | null = null;
    try {
      const response = await fetch("/api/tds-receivables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, invNumber, invDate, invValue, observation, followUp }),
      });
      const payload = await response.json();
      if (!response.ok) error = payload.error ?? "Could not save.";
    } catch {
      error = "Could not reach the server.";
    }
    setBusy(false);
    setMessage(error ? { text: error, ok: false } : { text: "Saved", ok: true });
    if (!error) router.refresh();
  };

  const text = (value: string, set: (v: string) => void, placeholder: string, width: string) =>
    canCommit ? (
      <input
        value={value}
        onChange={(e) => set(e.target.value)}
        placeholder={placeholder}
        className={clsx(field, width)}
      />
    ) : (
      <span className="whitespace-pre-wrap text-ink">{value || <span className="text-ink-faint">—</span>}</span>
    );
  const area = (value: string, set: (v: string) => void, placeholder: string, rows = 2) =>
    canCommit ? (
      <textarea
        value={value}
        onChange={(e) => set(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        className={field}
      />
    ) : (
      <span className="whitespace-pre-wrap text-ink">{value || <span className="text-ink-faint">—</span>}</span>
    );

  return (
    <tr className="hover:bg-surface-sunk/40">
      <td className={clsx(td, "text-ink-muted")}>{row.fy}</td>
      <td className={clsx(td, "text-ink")}>{row.vertical}</td>
      <td className={clsx(td, "min-w-[9rem] text-ink")}>{row.customer}</td>
      <td className={clsx(td, "num text-right text-ink")}>{money(row.tdsAmount, 2)}</td>
      <td className={clsx(td, "min-w-[12rem]")}>
        <div className="space-y-1">
          {line("Inv number", text(invNumber, setInvNumber, "Invoice number(s)", "w-full"))}
          {line("Inv date", text(invDate, setInvDate, "Invoice date(s)", "w-full"))}
          {line("Inv value", text(invValue, setInvValue, "Invoice value", "w-full num"))}
          {line(
            "TDS @ 10%",
            <span className="num font-medium text-ink">
              {tenPercent === null ? <span className="text-ink-faint">—</span> : money(tenPercent, 2)}
            </span>,
          )}
        </div>
      </td>
      <td className={clsx(td, "min-w-[12rem]")}>{area(observation, setObservation, "Observation", 5)}</td>
      <td className={clsx(td, "min-w-[12rem]")}>{area(followUp, setFollowUp, "Follow-up action", 5)}</td>
      <td className={clsx(td, "whitespace-nowrap text-right")}>
        {canCommit && (
          <button
            type="button"
            onClick={onSave}
            disabled={busy || !dirty}
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
  );
}

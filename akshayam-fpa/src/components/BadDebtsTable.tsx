import { dateLabel, money } from "@/lib/format";
import type { BadDebtsResult } from "@/lib/reports/bad-debts";

/** Whole rupees as whole, anything else to the paisa: a write-off can be 43 paise. */
export function rupees(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return money(rounded, Number.isInteger(rounded) ? 0 : 2);
}

/**
 * The write-offs behind the Receivables card: first what each vertical wrote off (when there is
 * more than one line to show), then every invoice, grouped under its vertical.
 */
export function BadDebtsTable({ data }: { data: BadDebtsResult }) {
  const head =
    "border-y border-line px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-faint";
  const cell = "border-b border-line px-3 py-2";
  const showVertical = data.byVertical.some((v) => v.verticalId !== null);

  if (data.rows.length === 0) {
    return <p className="px-4 py-6 text-center text-[13px] text-ink-muted">Nothing written off in this period.</p>;
  }

  return (
    <div className="space-y-4 pb-3">
      {showVertical && data.byVertical.length > 0 && (
        <div className="table-frame">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className={head}>Vertical</th>
                <th className={`${head} text-right`}>Invoices</th>
                <th className={`${head} text-right`}>Written off</th>
              </tr>
            </thead>
            <tbody>
              {data.byVertical.map((v) => (
                <tr key={String(v.verticalId)}>
                  <td className={cell}>{v.vertical ?? "No vertical"}</td>
                  <td className={`${cell} num text-right`}>{v.count}</td>
                  <td className={`${cell} num text-right font-medium`}>{rupees(v.total)}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="px-3 py-2">Total</td>
                <td className="num px-3 py-2 text-right">{data.count}</td>
                <td className="num px-3 py-2 text-right">{rupees(data.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div className="table-frame">
        <table className="w-full min-w-max border-collapse text-[13px]">
          <thead>
            <tr>
              <th className={head}>Written off on</th>
              {showVertical && <th className={head}>Vertical</th>}
              <th className={head}>Customer</th>
              <th className={head}>Invoice</th>
              <th className={`${head} text-right`}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.id}>
                <td className={`${cell} whitespace-nowrap`}>{dateLabel(r.writtenOffOn)}</td>
                {showVertical && <td className={cell}>{r.vertical ?? "—"}</td>}
                <td className={cell}>{r.customer ?? "—"}</td>
                <td className={`${cell} whitespace-nowrap`}>{r.reference}</td>
                <td className={`${cell} num text-right`}>{rupees(r.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

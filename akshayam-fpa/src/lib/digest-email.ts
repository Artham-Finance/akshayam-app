import { dateLabel, money, moneySigned, percent } from "@/lib/format";
import type { DigestAgeRow, DigestContent, DigestPeriod } from "@/lib/reports/digest";
import type { BudgetRow } from "@/lib/reports/budget";
import { ROWS, scorecardRowCodeFor } from "@/lib/reports/scorecard";

/**
 * The update, as an email: one block per company or slice the reader may see, and in it, only
 * the sections their report access allows. Inline styles and plain tables throughout - the only
 * thing every mail client agrees on.
 */

export interface DigestSections {
  revenue: boolean;
  collection: boolean;
  receivables: boolean;
}

const NAVY = "#16263C";
const INK = "#1d2733";
const MUTED = "#6b7684";
const RULE = "#d9dee5";
const GOOD = "#1f7a4d";
const BAD = "#b3382c";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The table styles, once, in the head: a group's mail runs to hundreds of cells, and Gmail clips a message past 102 KB. */
const STYLES = `
  .th{padding:6px 8px;border-bottom:1px solid ${RULE};font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:${MUTED};white-space:nowrap;text-align:right}
  .td{padding:6px 8px;border-bottom:1px solid ${RULE};font-size:13px;color:${INK};white-space:nowrap;text-align:right}
  .l{text-align:left}
  .td.l{white-space:normal}
  .b{font-weight:700}
  .t{border-top:2px solid ${NAVY}}
  .g{color:${GOOD}}
  .x{color:${BAD}}
  .m{color:${MUTED}}`;

const th = (label: string, align: "left" | "right" = "right") =>
  `<th align="${align}" class="th${align === "left" ? " l" : ""}">${esc(label)}</th>`;

const td = (
  value: string,
  opts: { align?: "left" | "right"; bold?: boolean; tone?: "g" | "x" | "m"; top?: boolean } = {},
) =>
  `<td align="${opts.align ?? "right"}" class="td${opts.align === "left" ? " l" : ""}${opts.bold ? " b" : ""}${opts.top ? " t" : ""}${opts.tone ? ` ${opts.tone}` : ""}">${value}</td>`;

function bvaRow(r: BudgetRow, total = false): string {
  const c = r.period;
  const ok = c.variance >= 0;
  const tone = c.periodBudget === 0 && c.actual === 0 ? "m" : ok ? "g" : "x";
  const o = { bold: total, top: total };
  return `<tr>${td(esc(total ? "Total" : r.name), { align: "left", ...o })}${td(money(c.periodBudget), o)}${td(money(c.actual), o)}${td(moneySigned(c.variance), { ...o, tone })}${td(c.achievement === null ? "-" : percent(c.achievement), { ...o, tone })}</tr>`;
}

function periodTable(p: DigestPeriod): string {
  return `
    <p style="margin:14px 0 4px;font-size:13px;font-weight:700;color:${INK}">${esc(p.title)} <span style="font-weight:400;color:${MUTED}">&middot; ${esc(p.range)}</span></p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
      <tr>${th("Vertical", "left")}${th("Budget")}${th("Actual")}${th("Variance")}${th("Achieved")}</tr>
      ${p.rows.map((r) => bvaRow(r)).join("")}
      ${p.rows.length === 1 ? "" : bvaRow(p.total, true)}
    </table>`;
}

function ageRow(r: DigestAgeRow, total = false): string {
  const o = { bold: total, top: total };
  const cells = r.buckets.map((n) => td(n ? money(n) : "-", o)).join("");
  return `<tr>${td(esc(r.name), { align: "left", ...o })}${cells}${td(money(r.total), { ...o, bold: true })}</tr>`;
}

function section(title: string, note: string | null, body: string): string {
  return `
    <h3 style="margin:26px 0 0;padding-bottom:6px;border-bottom:2px solid ${NAVY};font-size:15px;color:${NAVY}">${esc(title)}</h3>
    ${note ? `<p style="margin:6px 0 0;font-size:12px;color:${MUTED}">${esc(note)}</p>` : ""}
    ${body}`;
}

function entityBlock(c: DigestContent, show: DigestSections): string {
  const facts = [
    c.glThrough ? `GL updated till ${dateLabel(c.glThrough)}` : "No GL posted this year",
    ...(show.collection && c.receiptsThrough ? [`Receipts through ${dateLabel(c.receiptsThrough)}`] : []),
    ...(show.receivables && c.receivablesAsOf ? [`Receivables as at ${dateLabel(c.receivablesAsOf)}`] : []),
  ];
  const parts = [
    `<h2 style="margin:30px 0 2px;font-size:19px;color:${NAVY}">${esc(c.entity.name)}</h2>`,
    `<p style="margin:0;font-size:12px;color:${MUTED}">${esc(facts.join("  ·  "))}</p>`,
  ];
  if (!c.glThisWeek) {
    parts.push(
      `<p style="margin:8px 0 0;padding:8px 10px;background:#fff6e0;border:1px solid #f0d9a0;border-radius:4px;font-size:12px;color:#7a5a00">The general ledger has not been updated this week, so the revenue figures may be incomplete.</p>`,
    );
  }
  if (show.revenue) {
    parts.push(section("Revenue — budget vs actual", null, c.revenue.map(periodTable).join("")));
  }
  if (show.collection) {
    parts.push(
      section(
        "Collection — budget vs actual",
        "Fee receipts; reimbursement recoveries are not counted. Budget is 108% of revenue budget.",
        c.collection.map(periodTable).join(""),
      ),
    );
  }
  if (show.receivables) {
    parts.push(
      section(
        "Receivables — by age",
        "What is owed, by days past due, on the latest receivables snapshot.",
        c.receivables
          ? `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:8px">
               <tr>${th("Vertical", "left")}${c.receivables.bands.map((b) => th(b)).join("")}${th("Total")}</tr>
               ${c.receivables.rows.map((r) => ageRow(r)).join("")}
               ${c.receivables.rows.length === 1 ? "" : ageRow(c.receivables.total, true)}
             </table>`
          : `<p style="font-size:13px;color:${MUTED}">No receivables snapshot has been loaded.</p>`,
      ),
    );
  }
  return parts.join("");
}

/* ---------- the same figures, a card to each vertical ---------- */

const ZERO_CELLS: BudgetRow["period"] = {
  periodBudget: 0,
  actual: 0,
  variance: 0,
  achievement: null,
  retainership: null,
  professional: null,
};

/** A vertical's head, as the scorecard names the row ("Vijay - DLR"), or null where it has none. */
function headOf(code: string | null): string | null {
  const row = code ? ROWS.find((r) => r.code === scorecardRowCodeFor(code)) : undefined;
  return row?.label.includes(" - ") ? row.label.split(" - ")[0] : null;
}

function cellsRow(label: string, c: BudgetRow["period"]): string {
  const tone = c.periodBudget === 0 && c.actual === 0 ? "m" : c.variance >= 0 ? "g" : "x";
  return `<tr>${td(esc(label), { align: "left", bold: true })}${td(money(c.periodBudget))}${td(money(c.actual))}${td(moneySigned(c.variance), { tone })}${td(c.achievement === null ? "-" : percent(c.achievement), { tone })}</tr>`;
}

function verticalCards(c: DigestContent, show: DigestSections): string {
  interface Card {
    key: string;
    code: string | null;
    name: string;
    order: number;
  }
  const cards = new Map<string, Card>();
  const note = (code: string | null, name: string) => {
    const key = code ?? name;
    if (cards.has(key)) return;
    const rowCode = code ? scorecardRowCodeFor(code) : null;
    const order = rowCode ? ROWS.findIndex((r) => r.code === rowCode) : 999;
    cards.set(key, { key, code, name, order });
  };
  for (const p of [...c.revenue, ...c.collection]) for (const r of p.rows) note(r.code, r.name);
  for (const r of c.receivables?.rows ?? []) note(r.code, r.name);
  const verticals = [...cards.values()].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

  const cell = (periods: DigestPeriod[], i: number, v: Card) =>
    periods[i]?.rows.find((r) => (r.code ?? r.name) === v.key)?.period ?? ZERO_CELLS;
  const titles = (c.revenue.length ? c.revenue : c.collection).map((p) => ({ title: p.title, range: p.range }));

  const facts = [
    c.glThrough ? `GL updated till ${dateLabel(c.glThrough)}` : "No GL posted this year",
    ...(show.collection && c.receiptsThrough ? [`Receipts through ${dateLabel(c.receiptsThrough)}`] : []),
  ];
  const out = [
    `<h2 style="margin:30px 0 2px;font-size:19px;color:${NAVY}">${esc(c.entity.name)}</h2>`,
    `<p style="margin:0;font-size:12px;color:${MUTED}">${esc(facts.join("  ·  "))}</p>`,
  ];
  if (!c.glThisWeek) {
    out.push(
      `<p style="margin:8px 0 0;padding:8px 10px;background:#fff6e0;border:1px solid #f0d9a0;border-radius:4px;font-size:12px;color:#7a5a00">The general ledger has not been updated this week, so the revenue figures may be incomplete.</p>`,
    );
  }

  for (const v of verticals) {
    const head = headOf(v.code);
    const name = head && v.name.startsWith(`${head} - `) ? v.name.slice(head.length + 3) : v.name;
    const age = c.receivables?.rows.find((r) => (r.code ?? r.name) === v.key);

    const periodBlocks = titles
      .map(
        (t, i) => `
      <p style="margin:14px 0 4px;font-size:13px;font-weight:700;color:${INK}">${esc(t.title)} <span style="font-weight:400;color:${MUTED}">&middot; ${esc(t.range)}</span></p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
        <tr>${th("", "left")}${th("Budget")}${th("Actual")}${th("Variance")}${th("Achieved")}</tr>
        ${show.collection ? cellsRow("Collection", cell(c.collection, i, v)) : ""}
        ${show.revenue ? cellsRow("Revenue", cell(c.revenue, i, v)) : ""}
      </table>`,
      )
      .join("");

    const receivables =
      show.receivables && c.receivables
        ? `
      <p style="margin:18px 0 4px;font-size:13px;font-weight:700;color:${INK}">Receivables as on ${esc(dateLabel(c.glThrough ?? c.receivablesAsOf))}${c.receivablesAsOf && c.receivablesAsOf !== c.glThrough ? ` <span style="font-weight:400;color:${MUTED}">&middot; latest receivables snapshot ${esc(dateLabel(c.receivablesAsOf))}</span>` : ""}</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
        <tr>${c.receivables.bands.map((b) => th(b)).join("")}${th("Total")}</tr>
        <tr>${(age?.buckets ?? c.receivables.bands.map(() => 0)).map((n) => td(n ? money(n) : "-")).join("")}${td(money(age?.total ?? 0), { bold: true })}</tr>
      </table>`
        : "";

    out.push(`
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:22px;border:1px solid ${RULE};border-radius:6px"><tr><td style="padding:0 16px 16px">
      <div style="margin:0 -16px;padding:12px 16px;background:#eef2f7;border-radius:6px 6px 0 0;border-bottom:2px solid ${NAVY}">
        <div style="font-size:16px;font-weight:700;color:${NAVY}">${esc(name)}</div>
        <div style="margin-top:2px;font-size:12.5px;color:${MUTED}">Vertical head: <strong style="color:${INK}">${esc(head ?? "-")}</strong></div>
      </div>
      ${periodBlocks}${receivables}
    </td></tr></table>`);
  }
  return out.join("");
}

export function renderDigestEmail(opts: {
  recipientName: string | null;
  contents: DigestContent[];
  show: DigestSections;
  asOf: string;
  appUrl: string | null;
  /** "byVertical" (the default): a card to each vertical; "summary": a table per measure and period */
  layout?: "summary" | "byVertical";
}): { subject: string; html: string; text: string } {
  const { recipientName, contents, show, asOf, appUrl } = opts;
  const block = opts.layout === "summary" ? entityBlock : verticalCards;
  const heading =
    contents.length === 1 ? contents[0].entity.name : "Akshayam Group";
  const subject = `${heading} — update for ${dateLabel(asOf)}`;

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${STYLES}</style></head><body style="margin:0;padding:0;background:#f4f6f8">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8"><tr><td align="center" style="padding:20px 10px">
  <table width="760" cellpadding="0" cellspacing="0" style="max-width:760px;width:100%;background:#ffffff;border:1px solid ${RULE};border-radius:8px">
    <tr><td style="background:${NAVY};padding:18px 24px;border-radius:8px 8px 0 0">
      <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#9fb0c6">Management reporting</div>
      <div style="font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:700;color:#ffffff;margin-top:2px">Update for ${esc(dateLabel(asOf))}</div>
    </td></tr>
    <tr><td style="padding:6px 24px 26px;font-family:Arial,Helvetica,sans-serif;color:${INK}">
      <p style="margin:18px 0 0;font-size:14px">${recipientName ? `Hello ${esc(recipientName)},` : "Hello,"}</p>
      <p style="margin:6px 0 0;font-size:14px">Here is where revenue, collection and receivables stand.</p>
      ${contents.map((c) => block(c, show)).join("")}
      <p style="margin:30px 0 0;padding-top:12px;border-top:1px solid ${RULE};font-size:11.5px;line-height:1.5;color:${MUTED}">
        These are the figures of the Revenue, Collections and Receivables pages, from the general ledger, the receipts and the receivables snapshot as last loaded.
        The week runs Sunday to today; a month's and the year's budget is struck on whole months, as on those pages. Variance is actual less budget.
        ${appUrl ? `<br><a href="${esc(appUrl)}" style="color:${NAVY}">Open the dashboard</a>` : ""}
      </p>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;

  const lines: string[] = [`Update for ${dateLabel(asOf)}`, ""];
  for (const c of contents) {
    lines.push(c.entity.name, `GL updated till ${c.glThrough ? dateLabel(c.glThrough) : "-"}`, "");
    const bva = (label: string, periods: DigestPeriod[]) => {
      lines.push(label);
      for (const p of periods) {
        const t = p.total.period;
        lines.push(
          `  ${p.title}: budget ${money(t.periodBudget)}, actual ${money(t.actual)}, ${t.achievement === null ? "-" : percent(t.achievement)} achieved`,
        );
      }
      lines.push("");
    };
    if (show.revenue) bva("Revenue", c.revenue);
    if (show.collection) bva("Collection", c.collection);
    if (show.receivables && c.receivables) {
      lines.push(`Receivables: ${money(c.receivables.total.total)} outstanding`);
      c.receivables.bands.forEach((b, i) => lines.push(`  ${b}: ${money(c.receivables!.total.buckets[i])}`));
      lines.push("");
    }
  }
  if (appUrl) lines.push(appUrl);
  return { subject, html, text: lines.join("\n") };
}

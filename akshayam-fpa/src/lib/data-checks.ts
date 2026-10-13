import { query } from "@/lib/db";
import { listAllEntities } from "@/lib/entity";
import { buildBudgetVsActual } from "@/lib/reports/budget";
import { buildBudgetVsActualPnl } from "@/lib/reports/budget-pnl";
import { buildProfitAndLoss } from "@/lib/reports/statements";
import { fyMonths } from "@/lib/period";
import {
  COLLECTION_BUDGET_RATIO,
  REVISED_CONTROL_TOTALS,
  revisedCompanyTotal,
  revisedQuarterlyTable,
} from "@/lib/reports/scorecard-budget";
import { ROWS, buildScorecard, resolveScorecardScope } from "@/lib/reports/scorecard";
import { TEAM_COST_ANNUAL_BUDGET } from "@/lib/reports/team-cost";
import {
  buildCumulativeCostApportionment,
  buildVerticalCostApportionment,
} from "@/lib/reports/vertical-cost-apportionment";
import type { QuarterNo } from "@/lib/period";

/**
 * Checks that the figures on screen still tie to the files they came from.
 *
 * Every one of these has already gone wrong once: a vertical code held by both
 * companies made a budget read against the wrong company, so an Overview showed
 * 6.62 cr where the revised budget says 6.37 cr; a team cost table drifted from
 * the planning workbook until a breakup stopped adding to its statement line. A
 * check that runs on the live data, and says so plainly, finds that before a
 * reader does.
 *
 * The control totals are the revised budget file's own (see scorecard-budget.ts),
 * typed in once, and every figure is compared with them as the screens compute
 * it - not as the table is stored.
 */

export type CheckStatus = "ok" | "warn" | "fail" | "skip";

export interface DataCheck {
  id: string;
  title: string;
  status: CheckStatus;
  detail: string;
}

const FY = 2026;
const rs = (n: number) => Math.round(n).toLocaleString("en-IN");

async function guarded(
  id: string,
  title: string,
  run: () => Promise<Omit<DataCheck, "id" | "title">>,
): Promise<DataCheck> {
  try {
    return { id, title, ...(await run()) };
  } catch (err) {
    return {
      id,
      title,
      status: "fail",
      detail: `The check could not run: ${err instanceof Error ? err.message : "unknown error"}.`,
    };
  }
}

export async function runDataChecks(): Promise<DataCheck[]> {
  const entities = await listAllEntities();
  const companies = entities.filter((e) => !e.isGroup && e.verticalIds === null);
  const group = entities.find((e) => e.isGroup && e.verticalIds === null) ?? null;

  const checks: Promise<DataCheck>[] = [];

  /* A vertical code held by both companies. */
  checks.push(
    guarded("duplicate-codes", "No vertical code is held by both companies", async () => {
      const rows = await query<{ code: string; slugs: string[] }>(
        `select upper(v.code) as code, array_agg(distinct e.slug order by e.slug) as slugs
           from verticals v join entities e on e.id = v.entity_id
          where e.slug in ('rbjv', 'akshayam')
          group by upper(v.code)
         having count(distinct v.entity_id) > 1`,
      );
      if (rows.length === 0) return { status: "ok", detail: "Every vertical code belongs to one company." };
      return {
        status: "warn",
        detail:
          rows.map((r) => `${r.code} is held by ${r.slugs.join(" and ")}`).join("; ") +
          ". Budgets are matched to each company's own vertical, so the figures stay right, but the same code in " +
          "both companies is usually a stray tag from an upload - open Settings → Verticals and merge or map it.",
      };
    }),
  );

  /* The revised budget table agrees with the file it was typed from. */
  checks.push(
    guarded("revised-table", "The revised budget table matches its file", async () => {
      const controls = REVISED_CONTROL_TOTALS[FY];
      if (!controls) return { status: "skip", detail: "No revised budget is held for the year." };
      const problems: string[] = [];
      for (const [slug, expected] of Object.entries(controls)) {
        const held = revisedCompanyTotal(FY, slug);
        if (Math.abs(held - expected) > 1) {
          problems.push(`${slug}: the table totals ${rs(held)}, the file says ${rs(expected)}`);
        }
      }
      return problems.length === 0
        ? { status: "ok", detail: Object.entries(controls).map(([s, v]) => `${s} ${rs(v)}`).join(" · ") }
        : { status: "fail", detail: problems.join("; ") };
    }),
  );

  /* The Overview's annual budget, as it is computed, per company and for the group. */
  checks.push(
    guarded("overview-budget", "The Overview's annual budget equals the revised file", async () => {
      const controls = REVISED_CONTROL_TOTALS[FY];
      if (!controls) return { status: "skip", detail: "No revised budget is held for the year." };
      const window = { start: `${FY}-04-01`, end: `${FY}-09-30`, fraction: 0.5, monthAligned: true };
      const problems: string[] = [];
      const seen: string[] = [];
      let groupExpected = 0;
      for (const company of companies) {
        const expected = controls[company.slug];
        if (expected === undefined) continue;
        groupExpected += expected;
        const result = await buildBudgetVsActual({
          entity: company,
          fyStartYear: FY,
          measure: "revenue",
          period: window,
          revised: true,
        });
        seen.push(`${company.slug} ${rs(result.total.annual)}`);
        if (Math.abs(result.total.annual - expected) > 1) {
          problems.push(`${company.slug}: shows ${rs(result.total.annual)}, the file says ${rs(expected)}`);
        }
      }
      if (group) {
        const result = await buildBudgetVsActual({
          entity: group,
          fyStartYear: FY,
          measure: "revenue",
          period: window,
          revised: true,
        });
        seen.push(`group ${rs(result.total.annual)}`);
        if (Math.abs(result.total.annual - groupExpected) > 1) {
          problems.push(`group: shows ${rs(result.total.annual)}, the companies add to ${rs(groupExpected)}`);
        }
      }
      return problems.length === 0
        ? { status: "ok", detail: seen.join(" · ") }
        : { status: "fail", detail: problems.join("; ") };
    }),
  );

  /*
    A period's budget is the same on every page: the revised table's quarters it
    covers. Struck here for each quarter and for the first half, on the Revenue
    tab, the Collections tab and the P&L's Revenue line, against the table itself.
  */
  checks.push(
    guarded("period-budgets", "A period's budget is the same on every page", async () => {
      const table = (slug: string) => revisedQuarterlyTable(FY, [slug]);
      const windows = [
        { label: "Q1", months: [4, 5, 6], start: `${FY}-04-01`, end: `${FY}-06-30` },
        { label: "Q2", months: [7, 8, 9], start: `${FY}-07-01`, end: `${FY}-09-30` },
        { label: "Q3", months: [10, 11, 12], start: `${FY}-10-01`, end: `${FY}-12-31` },
        { label: "Q4", months: [1, 2, 3], start: `${FY + 1}-01-01`, end: `${FY + 1}-03-31` },
        { label: "Q1+Q2", months: [4, 5, 6, 7, 8, 9], start: `${FY}-04-01`, end: `${FY}-09-30` },
      ];
      const quarterOf = (month: number) => Math.floor(((month - 4 + 12) % 12) / 3);
      const problems: string[] = [];
      let compared = 0;
      for (const company of companies) {
        const rows = table(company.slug);
        if (!rows) continue;
        const pnl = await buildBudgetVsActualPnl({ entity: company, fyStartYear: FY });
        const pnlRevenue = pnl.lines.find((l) => l.code === "revenue")!;
        for (const w of windows) {
          let expected = 0;
          for (const q of Object.values(rows)) for (const m of w.months) expected += q[quarterOf(m)] / 3;
          const period = { start: w.start, end: w.end, fraction: w.months.length / 12, monthAligned: true };
          const revenue = await buildBudgetVsActual({ entity: company, fyStartYear: FY, measure: "revenue", period, revised: true });
          const collection = await buildBudgetVsActual({ entity: company, fyStartYear: FY, measure: "collection", period, revised: true });
          const inPnl = pnl.months
            .filter((m) => m.start >= w.start && m.start <= w.end)
            .reduce((sum, m) => sum + (pnlRevenue.budget[m.key] ?? 0), 0);
          const shown: [string, number, number][] = [
            ["Revenue tab", revenue.total.period.periodBudget, expected],
            ["Collections tab", collection.total.period.periodBudget, expected * COLLECTION_BUDGET_RATIO],
            ["P&L revenue line", inPnl, expected],
          ];
          for (const [where, got, want] of shown) {
            compared++;
            if (Math.abs(got - want) > 2) {
              problems.push(`${company.slug} ${w.label} on the ${where}: ${rs(got)}, the table says ${rs(want)}`);
            }
          }
        }
      }
      if (compared === 0) return { status: "skip", detail: "No revised budget is held for the year." };
      return problems.length === 0
        ? { status: "ok", detail: `Q1, Q2, Q3, Q4 and the first half agree on the Revenue tab, the Collections tab and the P&L (${compared} comparisons)` }
        : { status: "fail", detail: problems.slice(0, 6).join("; ") };
    }),
  );

  /*
    The P&L's cost apportionment card and the Vertical Performance Scorecard are
    meant to be one method: for each of the six verticals, the revenue, total cost
    (direct plus apportioned) and contribution on the card are what the scorecard
    rates. Struck here for every quarter and for the quarters added up, off both
    builders, so a change to one that the other does not follow is found.
  */
  checks.push(
    guarded("apportionment-scorecard", "Apportionment cost matches the Vertical Performance Scorecard, vertical-wise", async () => {
      const problems: string[] = [];
      let compared = 0;
      const rowByKey = new Map(ROWS.filter((r) => r.apportKey).map((r) => [r.apportKey as string, r]));
      for (const company of companies) {
        const windows: { label: string; quarter: QuarterNo; cumulative: boolean }[] = [
          ...([1, 2, 3, 4] as QuarterNo[]).map((q) => ({ label: `Q${q}`, quarter: q, cumulative: false })),
          ...([2, 3, 4] as QuarterNo[]).map((q) => ({ label: `Q1–Q${q} cumulative`, quarter: q, cumulative: true })),
        ];
        for (const w of windows) {
          const card = w.cumulative
            ? await buildCumulativeCostApportionment({ entity: company, fyStartYear: FY, throughQuarter: w.quarter })
            : await buildVerticalCostApportionment({ entity: company, fyStartYear: FY, quarter: w.quarter });
          // the card only exists where the company has the six; nothing to compare otherwise
          if (card.verticals.every((v) => v.revenue === 0 && v.totalCost === 0)) continue;
          const sc = await buildScorecard({ entity: company, fyStartYear: FY, quarter: w.quarter, cumulative: w.cumulative });
          for (const v of card.verticals) {
            // Raja's AIF is on the card with its own cost only; the scorecard's Raja row is AIF and GIFT
            if (v.key === "AIF") continue;
            const row = sc.rows.find((r) => r.code === rowByKey.get(v.key)?.code);
            if (!row) {
              // a vertical with no activity is left off the scorecard, and has nothing on the card either
              if (Math.abs(v.revenue) + Math.abs(v.totalCost) >= 2) {
                problems.push(`${company.slug} ${w.label} ${v.key}: on the card, missing from the scorecard`);
              }
              continue;
            }
            const pairs: [string, number, number][] = [
              ["revenue", v.revenue, row.contributionRevenue],
              // the scorecard also carries each vertical's finance cost and out-of-books billing, which the card does not
              ["total cost", v.totalCost, row.cost - row.financeCost],
              ["contribution", v.contribution, row.revenueContribution + row.financeCost - row.osbRevenue],
            ];
            for (const [what, onCard, onScorecard] of pairs) {
              compared++;
              if (Math.abs(onCard - onScorecard) > 2) {
                problems.push(`${company.slug} ${w.label} ${v.key} ${what}: card ${rs(onCard)}, scorecard ${rs(onScorecard)}`);
              }
            }
          }
        }
      }
      if (compared === 0 && problems.length === 0) return { status: "skip", detail: "There is no apportionment to compare yet." };
      return problems.length === 0
        ? { status: "ok", detail: `Revenue, total cost and contribution agree for the six verticals, in every quarter and cumulatively (${compared} comparisons)` }
        : { status: "fail", detail: problems.slice(0, 6).join("; ") + (problems.length > 6 ? `; and ${problems.length - 6} more` : "") };
    }),
  );

  /*
    The scorecard's net revenue contribution, in total, is the P&L's profit before tax
    (EBITDA less finance cost) - each vertical's finance cost on its own row, DSC as
    a line, and RE / RI and anything booked to no vertical on Common's direct cost.
    Struck for each company and the group, for every quarter and for the year.
  */
  checks.push(
    guarded("scorecard-pnl", "The scorecard's total contribution equals the P&L's profit before tax", async () => {
      const problems: string[] = [];
      let compared = 0;
      const scopes = [...companies, ...(group ? [group] : [])];
      for (const entity of scopes) {
        const windows: { label: string; quarter: QuarterNo; cumulative: boolean }[] = [
          ...([1, 2, 3, 4] as QuarterNo[]).map((q) => ({ label: `Q${q}`, quarter: q, cumulative: false })),
          { label: "the year", quarter: 4 as QuarterNo, cumulative: true },
        ];
        for (const w of windows) {
          const sc = await buildScorecard({ entity, fyStartYear: FY, quarter: w.quarter, cumulative: w.cumulative });
          if (sc.rows.length === 0) continue;
          compared++;
          if (Math.abs(sc.unreconciled) > 2) {
            problems.push(`${entity.slug} ${w.label}: ${rs(sc.unreconciled)} of the P&L is on no row`);
          }
        }
      }
      if (compared === 0) return { status: "skip", detail: "There is no scorecard to compare yet." };
      return problems.length === 0
        ? { status: "ok", detail: `Every window ties to the P&L (${compared} comparisons)` }
        : {
            status: "fail",
            detail:
              problems.slice(0, 6).join("; ") +
              ". Something in the P&L is on a vertical the scorecard does not carry - open the Net revenue contribution card.",
          };
    }),
  );

  /*
    Actual revenue and actual collection are one figure wherever they are read: the
    Overview, the Vertical Performance Scorecard, the P&L and Budget vs Actual
    (revenue only - they have no collection) agree for the group, RBJV, Akshayam
    and Raja (AIF + GIFT). The P&L and Budget vs Actual show the revenue Akshayam
    passed on to RBJV as its own line, and read as the Overview does on the net
    revenue line beneath it. Struck for each quarter.
  */
  checks.push(
    guarded("actuals-across-tabs", "Actual revenue and collection agree on the Overview, Scorecard, P&L and Budget vs Actual", async () => {
      const scopes = [
        ...(group ? [group] : []),
        ...companies,
        ...entities.filter((e) => e.slug === "raja"),
      ];
      const problems: string[] = [];
      let compared = 0;
      const months = fyMonths(FY);
      for (const entity of scopes) {
        for (const quarter of [1, 2, 3, 4] as QuarterNo[]) {
          const qm = months.filter((m) => m.quarter === quarter);
          const start = qm[0].start;
          const end = qm[qm.length - 1].end;
          const period = { start, end, fraction: 3 / 12, monthAligned: true };
          const [ovRev, ovCol] = await Promise.all([
            buildBudgetVsActual({ entity, fyStartYear: FY, measure: "revenue", period, revised: true }),
            buildBudgetVsActual({ entity, fyStartYear: FY, measure: "collection", period, revised: true }),
          ]);
          if (Math.abs(ovRev.total.period.actual) < 1 && Math.abs(ovCol.total.period.actual) < 1) continue;

          const scope = await resolveScorecardScope(entity);
          const sc = await buildScorecard({ entity: scope.benchmark, fyStartYear: FY, quarter, cumulative: false });
          const rows = scope.isSlice && scope.visibleCodes ? sc.rows.filter((r) => scope.visibleCodes!.has(r.code)) : sc.rows;
          const unrated = scope.isSlice ? [] : sc.unrated;
          const scRev = rows.reduce((t, r) => t + r.revenueActual, 0) + unrated.reduce((t, u) => t + u.revenueActual, 0);
          const scCol = rows.reduce((t, r) => t + r.collectionActual, 0) + unrated.reduce((t, u) => t + u.collectionActual, 0);

          const total = (values: Record<string, number>) =>
            qm.reduce((t, m) => t + (values[m.key] ?? 0), 0);
          const pl = await buildProfitAndLoss({ entity, fyStartYear: FY, verticalId: null, window: { start, end } });
          const plLine = (code: string) => pl.lines.find((l) => l.level === 0 && l.groupCode === code);
          const plRev = plLine("net_revenue")
            ? total(plLine("net_revenue")!.values)
            : total(plLine("revenue")?.values ?? {}) + total(plLine("osb_revenue")?.values ?? {});
          const bva = await buildBudgetVsActualPnl({ entity, fyStartYear: FY, window: { start, end } });
          const bvaLine = bva.lines.find((l) => l.code === "net_revenue") ?? bva.lines.find((l) => l.code === "revenue")!;
          const bvaRev = total(bvaLine.actual);

          const revenue: [string, number][] = [["Scorecard", scRev], ["P&L", plRev], ["Budget vs Actual", bvaRev]];
          for (const [where, got] of revenue) {
            compared++;
            if (Math.abs(got - ovRev.total.period.actual) > 2) {
              problems.push(`${entity.slug} Q${quarter} revenue on the ${where}: ${rs(got)}, the Overview ${rs(ovRev.total.period.actual)}`);
            }
          }
          compared++;
          if (Math.abs(scCol - ovCol.total.period.actual) > 2) {
            problems.push(`${entity.slug} Q${quarter} collection on the Scorecard: ${rs(scCol)}, the Overview ${rs(ovCol.total.period.actual)}`);
          }
        }
      }
      if (compared === 0) return { status: "skip", detail: "There is no activity to compare yet." };
      return problems.length === 0
        ? { status: "ok", detail: `Group, RBJV, Akshayam and Raja agree in every quarter (${compared} comparisons)` }
        : { status: "fail", detail: problems.slice(0, 6).join("; ") + (problems.length > 6 ? `; and ${problems.length - 6} more` : "") };
    }),
  );

  /* The team cost table's totals against the planning workbook's team cost budget. */
  checks.push(
    guarded("team-cost-table", "The team cost table matches the planning workbook", async () => {
      const problems: string[] = [];
      const seen: string[] = [];
      for (const company of companies) {
        const codes = Object.keys(TEAM_COST_ANNUAL_BUDGET).filter((code) =>
          company.slug === "akshayam" ? code === "GIFT" : code !== "GIFT",
        );
        if (company.slug !== "rbjv" && company.slug !== "akshayam") continue;
        const table = codes.reduce(
          (s, code) => s + Object.values(TEAM_COST_ANNUAL_BUDGET[code]).reduce((a, b) => a + (b ?? 0), 0),
          0,
        );
        const [row] = await query<{ annual: number | null }>(
          `select sum(amount)::float8 as annual from budget_pnl
            where entity_id = $1 and fy_start_year = $2 and group_code = 'direct_cost'`,
          [company.id, FY],
        );
        if (row?.annual == null) {
          seen.push(`${company.slug}: no budget loaded`);
          continue;
        }
        seen.push(`${company.slug} ${rs(table)}`);
        if (Math.abs(Number(row.annual) - table) > 2) {
          problems.push(
            `${company.slug}: the table totals ${rs(table)}, the planning workbook's team cost is ${rs(Number(row.annual))}`,
          );
        }
      }
      return problems.length === 0
        ? { status: "ok", detail: seen.join(" · ") }
        : {
            status: "fail",
            detail:
              problems.join("; ") +
              ". The Team cost card will show the difference as \"Not itemised in the plan\" until the table is refreshed from the workbook.",
          };
    }),
  );

  return Promise.all(checks);
}

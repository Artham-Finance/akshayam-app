import { query } from "@/lib/db";
import { listAllEntities } from "@/lib/entity";
import { buildBudgetVsActual } from "@/lib/reports/budget";
import { REVISED_CONTROL_TOTALS, revisedCompanyTotal } from "@/lib/reports/scorecard-budget";
import { TEAM_COST_ANNUAL_BUDGET } from "@/lib/reports/team-cost";

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

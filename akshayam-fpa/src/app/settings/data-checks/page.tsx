import clsx from "clsx";
import { Card, PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/auth/dal";
import { runDataChecks, type CheckStatus } from "@/lib/data-checks";

export const dynamic = "force-dynamic";

const TONE: Record<CheckStatus, string> = {
  ok: "bg-positive-tint text-positive",
  warn: "bg-caution-tint text-caution",
  fail: "bg-negative-tint text-negative",
  skip: "bg-surface-sunk text-ink-faint",
};
const LABEL: Record<CheckStatus, string> = { ok: "OK", warn: "Check", fail: "Wrong", skip: "Skipped" };

/**
 * Whether the figures on screen still tie to the files they came from, run on
 * the live data each time the page opens. Admin only: it reads across both
 * companies.
 */
export default async function DataChecksPage() {
  await requirePermission("users.manage");
  const checks = await runDataChecks();
  const worst = checks.some((c) => c.status === "fail")
    ? "fail"
    : checks.some((c) => c.status === "warn")
      ? "warn"
      : "ok";

  return (
    <>
      <PageHeader
        title="Data checks"
        subtitle={
          worst === "ok"
            ? "Everything ties to its source."
            : worst === "warn"
              ? "Figures tie, but something in the data is worth a look."
              : "A figure on screen does not tie to its source."
        }
      />
      <div className="space-y-3">
        {checks.map((c) => (
          <Card key={c.id}>
            <div className="flex flex-wrap items-start gap-3">
              <span
                className={clsx(
                  "mt-0.5 inline-flex min-w-[4.5rem] justify-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em]",
                  TONE[c.status],
                )}
              >
                {LABEL[c.status]}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-medium text-ink">{c.title}</p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">{c.detail}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}

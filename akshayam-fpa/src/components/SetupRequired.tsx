import { Card, Notice } from "@/components/ui";

/**
 * Failure screen for a page that could not load.
 *
 * It distinguishes "the database is not set up" from "a query went wrong",
 * because showing setup instructions for a code bug sends someone off
 * re-running migrations that were never the problem.
 */

/** Postgres/driver signals that genuinely mean "not set up yet". */
function isSetupProblem(message: string): boolean {
  return (
    /DATABASE_URL/i.test(message) ||
    /ECONNREFUSED|ENOTFOUND|connect/i.test(message) ||
    /password authentication|role .* does not exist/i.test(message) ||
    /database .* does not exist/i.test(message) ||
    /relation .* does not exist/i.test(message) ||
    /No companies are set up/i.test(message) ||
    /db:migrate|db:setup/i.test(message)
  );
}

export function SetupRequired({ message }: { message: string }) {
  if (!isSetupProblem(message)) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <Notice tone="negative" title="This page could not be loaded">
          {message}
        </Notice>
        <Card>
          <p className="text-[13px] leading-relaxed text-ink-muted">
            The database is reachable, so this is a fault in the report itself rather than
            anything wrong with your setup or your data. Nothing has been changed. Send this
            message over and it can be fixed &mdash; the other pages are unaffected.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Notice tone="caution" title="Database not ready">
        {message}
      </Notice>

      <Card>
        <h2 className="text-[14px] font-semibold text-ink">Finish the setup</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
          Open PowerShell in the project folder and run:
        </p>
        <pre className="mt-3 overflow-x-auto rounded-md bg-surface-sunk px-3 py-2.5 text-[12.5px] text-ink">
          npm run db:setup
        </pre>
        <p className="mt-3 text-[13px] leading-relaxed text-ink-muted">
          It asks for your PostgreSQL password once, in a hidden prompt, then creates the
          application role, the database and all the tables, and writes the connection
          settings to{" "}
          <code className="rounded bg-surface-sunk px-1 py-0.5 text-[12px]">.env.local</code>. The
          password is used for that one session and is never stored.
        </p>
        <p className="mt-3 border-t border-line pt-3 text-[13px] leading-relaxed text-ink-muted">
          Then restart the dev server so it picks up the new settings:{" "}
          <code className="rounded bg-surface-sunk px-1 py-0.5 text-[12px]">npm run dev</code>.
        </p>
      </Card>
    </div>
  );
}

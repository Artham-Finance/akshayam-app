import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
// Never prerendered or cached: the whole point is to report what *this*
// running process was built from, and a cached answer would go on describing
// the previous deploy.
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * What commit is actually serving.
 *
 * Deployed code used to be unfalsifiable from outside the box. The deploy job
 * ended with `echo "✅ Deployed <sha>"` - a hardcoded string that printed the
 * commit that *triggered* the run, whether or not that commit was the one
 * built, and the smoke test only asked whether the app was answering at all.
 * A box still serving last week's build passed both, so "pipeline green" and
 * "new code live" were never the same claim.
 *
 * `.version.json` is written by the deploy immediately before `next build`, so
 * the file describes the build sitting in `.next` rather than whatever git
 * happens to point at now. The deploy's smoke test reads this back and fails
 * the run when it does not match the commit it set out to deploy.
 *
 * Unauthenticated on purpose - see PUBLIC_PATHS in src/proxy.ts. It reveals a
 * commit SHA of a public repository and nothing else.
 */

type Version = {
  commit: string;
  builtAt: string | null;
  source: "file" | "env" | "unknown";
};

let cached: Version | null = null;

async function read(): Promise<Version> {
  if (cached) return cached;

  try {
    const raw = await readFile(join(process.cwd(), ".version.json"), "utf8");
    const parsed = JSON.parse(raw) as { commit?: unknown; builtAt?: unknown };
    if (typeof parsed.commit === "string" && parsed.commit) {
      cached = {
        commit: parsed.commit,
        builtAt: typeof parsed.builtAt === "string" ? parsed.builtAt : null,
        source: "file",
      };
      return cached;
    }
  } catch {
    // Falls through - a missing file is expected in dev and on a box that has
    // not been redeployed since this landed.
  }

  const fromEnv = process.env.APP_COMMIT;
  cached = fromEnv
    ? { commit: fromEnv, builtAt: null, source: "env" }
    : { commit: "unknown", builtAt: null, source: "unknown" };
  return cached;
}

export async function GET() {
  const version = await read();
  return NextResponse.json(version, {
    headers: { "cache-control": "no-store, max-age=0" },
  });
}

import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { apiGuard } from "@/lib/auth/dal";
import { claimScheduledRun, describeRecipients, digestEnabled, runDigest } from "@/lib/digest-run";
import { digestSecret } from "@/lib/digest-secret";
import { todayIst } from "@/lib/weekly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The Monday and Friday evening update.
 *
 *   POST  from the app's own timer (carrying its secret): the scheduled run. It claims the day
 *         first, so it goes out once however often it is asked.
 *   POST  from an admin: a manual send.
 *           ?to=me   only to the admin who asks - a test of the real thing
 *           ?to=all  to everyone signed up, now
 *   GET   from an admin: the update as the admin would receive it, drawn in the browser. Sends
 *         nothing. With ?recipients=1, the list of who is signed up and what each would see.
 */

function isScheduler(request: Request): boolean {
  const given = request.headers.get("x-digest-secret");
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(digestSecret());
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Monday or Friday, in India. */
function isSendDay(date: string): boolean {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 1 || day === 5;
}

export async function POST(request: Request) {
  try {
    if (isScheduler(request)) {
      const today = todayIst();
      if (!digestEnabled()) return NextResponse.json({ status: "disabled" });
      if (!isSendDay(today)) return NextResponse.json({ status: "not-a-send-day" });
      const runId = await claimScheduledRun(today);
      if (runId === null) return NextResponse.json({ status: "already-sent" });
      const outcome = await runDigest({ trigger: "scheduled", asOf: today, runId });
      return NextResponse.json({ status: "done", ...summary(outcome) });
    }

    const { user, denied } = await apiGuard("users.manage");
    if (denied) return denied;
    const to = new URL(request.url).searchParams.get("to");
    if (to !== "me" && to !== "all") {
      return NextResponse.json({ error: "Say who to send to: ?to=me or ?to=all." }, { status: 400 });
    }
    const outcome = await runDigest({
      trigger: "manual",
      onlyUserIds: to === "me" ? [user.id] : undefined,
    });
    return NextResponse.json({ status: "done", ...summary(outcome) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not send the update.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const { user, denied } = await apiGuard("users.manage");
  if (denied) return denied;
  try {
    // ?recipients=1: who would be sent the update, and what each would see. Sends nothing.
    if (new URL(request.url).searchParams.get("recipients") === "1") {
      return NextResponse.json({ recipients: await describeRecipients() });
    }
    const outcome = await runDigest({ trigger: "manual", onlyUserIds: [user.id], dryRun: true });
    const preview = outcome.previews[0];
    if (!preview) {
      return new NextResponse(
        "Nothing to show: your login has no company access, or no report access to Revenue, Collections or Receivables.",
        { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } },
      );
    }
    return new NextResponse(preview.html, {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not build the update.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function summary(o: { asOf: string; recipients: number; sent: number; failed: number; skipped: number; errors: unknown[] }) {
  return {
    asOf: o.asOf,
    recipients: o.recipients,
    sent: o.sent,
    failed: o.failed,
    skipped: o.skipped,
    errors: o.errors,
  };
}

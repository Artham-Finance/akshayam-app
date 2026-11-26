/**
 * Runs once when the server starts. The one thing it starts is the timer for the Monday and
 * Friday evening update, which only needs to ask the app's own route to do the work: nothing
 * heavy is imported here.
 *
 * Off unless DIGEST_ENABLED=true. The route claims each day in the database before it sends, so
 * a restart in the evening, or the timer firing more than once, cannot send the update twice.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.DIGEST_ENABLED !== "true") return;

  const g = globalThis as { __digestTimer?: boolean };
  if (g.__digestTimer) return;
  g.__digestTimer = true;

  const { digestSecret } = await import("./lib/digest-secret");
  const secret = digestSecret();
  const sendHour = Number(process.env.DIGEST_HOUR ?? 19); // 7 pm India time
  const port = process.env.PORT ?? "3000";
  let doneOn: string | null = null;

  const tick = async () => {
    const now = new Date();
    const date = now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const weekday = now.toLocaleDateString("en-US", { timeZone: "Asia/Kolkata", weekday: "short" });
    const hour = Number(
      now.toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false }).slice(0, 2),
    );
    if (doneOn === date || (weekday !== "Mon" && weekday !== "Fri") || hour < sendHour) return;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/digest/run`, {
        method: "POST",
        headers: { "x-digest-secret": secret },
      });
      const body = (await res.json().catch(() => ({}))) as { status?: string; error?: string };
      if (res.ok && body.status) {
        doneOn = date;
        console.log(`[digest] ${date}: ${body.status}`, JSON.stringify(body));
      } else {
        // The server may not be ready yet; try again on the next tick.
        console.error(`[digest] ${date}: ${res.status} ${body.error ?? ""}`);
        if (res.status >= 500) doneOn = date; // a failed run is not retried by itself: an admin re-sends
      }
    } catch (err) {
      console.error("[digest] could not reach the app:", err instanceof Error ? err.message : err);
    }
  };

  const timer = setInterval(() => void tick(), 60_000);
  timer.unref?.();
  console.log(`[digest] timer on: Mondays and Fridays from ${sendHour}:00 India time`);
}

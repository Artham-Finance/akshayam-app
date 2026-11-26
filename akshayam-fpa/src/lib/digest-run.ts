import { query, queryOne } from "@/lib/db";
import { listAllEntities, type Entity } from "@/lib/entity";
import { emailConfigured, sendEmail } from "@/lib/email";
import { renderDigestEmail, type DigestSections } from "@/lib/digest-email";
import { buildDigest, type DigestContent } from "@/lib/reports/digest";
import { todayIst } from "@/lib/weekly";

/**
 * Sending the Monday and Friday evening update.
 *
 * Each person flagged `users.receives_update` gets their own mail, drawn from what they may see: the companies,
 * the group or the partner slices they have been granted, and in each only the sections - revenue,
 * collection, receivables - their report access allows. A person who holds the group and a
 * company in it gets the group; the company is already in it.
 *
 * Nothing leaves unless DIGEST_ENABLED=true and SMTP is set up. DIGEST_TEST_TO, when set,
 * redirects every mail to that one address (subject marked with who it was for), for a rehearsal
 * with real figures before real recipients are switched on.
 */

export interface DigestOutcome {
  asOf: string;
  recipients: number;
  sent: number;
  failed: number;
  skipped: number;
  errors: { email: string; error: string }[];
  /** the rendered mails, for a dry run (nothing is sent) */
  previews: { to: string; bcc: string | null; subject: string; html: string }[];
}

export interface Recipient {
  id: number;
  email: string;
  name: string | null;
  entityIds: number[];
  reports: string[];
  /** addresses blind-copied on this person's update */
  copyTo: string | null;
}

export function digestEnabled(): boolean {
  return process.env.DIGEST_ENABLED === "true";
}

/** Whether one entity's figures are already inside another's, so a reader holding both is sent one. */
function covers(a: Entity, b: Entity): boolean {
  return a.id !== b.id && a.verticalIds === null && b.memberIds.every((m) => a.memberIds.includes(m));
}

function dedupe(list: Entity[]): Entity[] {
  return list
    .filter((b) => !list.some((a) => covers(a, b) && !covers(b, a)))
    .sort((a, b) => Number(b.isGroup) - Number(a.isGroup) || a.id - b.id);
}

export async function recipients(): Promise<Recipient[]> {
  const rows = await query<{
    id: number;
    email: string;
    name: string | null;
    entity_ids: number[] | null;
    report_codes: string[] | null;
    update_copy_to: string | null;
  }>(
    `select u.id, u.email, u.name, u.update_copy_to,
            array_remove(array_agg(distinct ue.entity_id), null) as entity_ids,
            array_remove(array_agg(distinct ura.report_code), null) as report_codes
       from users u
       left join user_entities ue on ue.user_id = u.id
       left join user_report_access ura on ura.user_id = u.id
      where u.is_active and u.receives_update and coalesce(u.email::text, '') <> ''
      group by u.id
      order by u.id`,
  );
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    name: r.name,
    entityIds: r.entity_ids ?? [],
    reports: r.report_codes ?? [],
    copyTo: r.update_copy_to?.trim() || null,
  }));
}

/** Who is signed up and what each would be sent - for an admin to check before anything goes out. */
export async function describeRecipients(): Promise<
  { email: string; name: string | null; copyTo: string | null; entities: string[]; sections: string[] }[]
> {
  const byId = new Map((await listAllEntities()).map((e) => [e.id, e]));
  return (await recipients()).map((r) => ({
    email: r.email,
    name: r.name,
    copyTo: r.copyTo,
    entities: dedupe(r.entityIds.map((id) => byId.get(id)).filter((e): e is Entity => !!e)).map((e) => e.name),
    sections: [
      ...(r.reports.includes("revenue") ? ["revenue"] : []),
      ...(r.reports.includes("collections") ? ["collection"] : []),
      ...(r.reports.includes("receivables") ? ["receivables"] : []),
    ],
  }));
}

/** Claim today's scheduled run, or null if one has already been made. */
export async function claimScheduledRun(runDate: string): Promise<number | null> {
  const row = await queryOne<{ id: number }>(
    `insert into digest_runs (run_date, trigger) values ($1, 'scheduled')
     on conflict (run_date) where trigger = 'scheduled' do nothing
     returning id`,
    [runDate],
  );
  return row?.id ?? null;
}

async function finishRun(id: number, status: "done" | "failed", outcome: Partial<DigestOutcome>, error?: string) {
  await query(
    `update digest_runs
        set status = $2, sent = $3, failed = $4, skipped = $5, finished_at = now(),
            detail = $6::jsonb
      where id = $1`,
    [
      id,
      status,
      outcome.sent ?? 0,
      outcome.failed ?? 0,
      outcome.skipped ?? 0,
      JSON.stringify({ errors: outcome.errors ?? [], error: error ?? null }),
    ],
  );
}

export async function runDigest(opts: {
  trigger: "scheduled" | "manual";
  /** the day the update is for; today (IST) by default */
  asOf?: string;
  /** only these users - a test send to oneself */
  onlyUserIds?: number[];
  /** render, but send nothing */
  dryRun?: boolean;
  /** a claimed scheduled run to close out */
  runId?: number | null;
}): Promise<DigestOutcome> {
  const asOf = opts.asOf ?? todayIst();
  const outcome: DigestOutcome = {
    asOf,
    recipients: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    errors: [],
    previews: [],
  };

  let runId = opts.runId ?? null;
  if (runId === null && !opts.dryRun) {
    const row = await queryOne<{ id: number }>(
      `insert into digest_runs (run_date, trigger) values ($1, $2) returning id`,
      [asOf, opts.trigger],
    );
    runId = row?.id ?? null;
  }

  try {
    if (!opts.dryRun && !emailConfigured()) {
      throw new Error("Email is not set up: SMTP_HOST, SMTP_USER, SMTP_PASS and SMTP_FROM are required.");
    }

    const entities = await listAllEntities();
    const byId = new Map(entities.map((e) => [e.id, e]));
    const appUrl = process.env.APP_URL ?? null;
    const testTo = process.env.DIGEST_TEST_TO?.trim() || null;

    // Each entity's figures are read once and shared by everyone who sees it.
    const built = new Map<number, Promise<DigestContent>>();
    const contentOf = (e: Entity) => {
      let p = built.get(e.id);
      if (!p) {
        p = buildDigest(e, asOf);
        built.set(e.id, p);
      }
      return p;
    };

    const everyone = (await recipients()).filter(
      (r) => !opts.onlyUserIds || opts.onlyUserIds.includes(r.id),
    );
    outcome.recipients = everyone.length;

    for (const person of everyone) {
      const show: DigestSections = {
        revenue: person.reports.includes("revenue"),
        collection: person.reports.includes("collections"),
        receivables: person.reports.includes("receivables"),
      };
      const mine = dedupe(person.entityIds.map((id) => byId.get(id)).filter((e): e is Entity => !!e));
      if ((!show.revenue && !show.collection && !show.receivables) || mine.length === 0) {
        outcome.skipped++;
        continue;
      }

      try {
        const contents = await Promise.all(mine.map(contentOf));
        const mail = renderDigestEmail({ recipientName: person.name, contents, show, asOf, appUrl });
        const to = testTo ?? person.email;
        const subject = testTo ? `[Test, for ${person.email}] ${mail.subject}` : mail.subject;
        // A rehearsal goes to one address only; the copies are for the real send.
        const bcc = testTo ? null : person.copyTo;
        if (opts.dryRun) {
          outcome.previews.push({ to, bcc, subject, html: mail.html });
        } else {
          await sendEmail({ to, ...(bcc ? { bcc } : {}), subject, html: mail.html, text: mail.text });
          outcome.sent++;
        }
      } catch (err) {
        outcome.failed++;
        outcome.errors.push({ email: person.email, error: err instanceof Error ? err.message : String(err) });
      }
    }

    if (runId !== null) await finishRun(runId, "done", outcome);
    return outcome;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (runId !== null) await finishRun(runId, "failed", outcome, message);
    throw err;
  }
}

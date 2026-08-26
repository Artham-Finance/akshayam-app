/**
 * Re-run the auto-mapping rules over accounts nobody has confirmed yet.
 *
 *   node --env-file-if-exists=.env.local scripts/remap.mts <entity-slug> [--apply]
 *
 * Ingest deliberately never re-guesses an account it has already seen: a
 * suggestion that keeps changing under the client's feet is worse than a
 * stale one. But when the rules themselves improve, the accounts loaded before
 * the improvement stay on the old answer forever. This is how they catch up.
 *
 * Accounts a human has confirmed (is_mapped = true) are never touched, and
 * nothing is written without --apply.
 */
import { pool } from "../src/lib/db";
import { suggestMapping } from "../src/lib/mapping";

const slug = process.argv[2];
const apply = process.argv.includes("--apply");
if (!slug || slug.startsWith("--")) {
  console.error("usage: node scripts/remap.mts <entity-slug> [--apply]");
  process.exit(1);
}

const entity = (
  await pool.query<{ id: number; name: string }>("select id, name from entities where slug = $1", [slug])
).rows[0];
if (!entity) {
  console.error(`No entity with slug "${slug}".`);
  process.exit(1);
}

const accounts = (
  await pool.query<{
    id: number;
    name: string;
    zoho_type: string | null;
    statement: string;
    group_code: string | null;
  }>(
    `select id, name, zoho_type, statement, group_code
       from accounts
      where entity_id = $1 and is_mapped = false
      order by name`,
    [entity.id],
  )
).rows;

let changed = 0;
for (const account of accounts) {
  const guess = suggestMapping(account.name, account.zoho_type);
  const nowMapped = guess.confidence === "high" && guess.statement !== "none";
  const differs = guess.statement !== account.statement || guess.groupCode !== account.group_code;
  if (!differs && !nowMapped) continue;

  changed++;
  console.log(
    `${account.name}\n   ${account.statement}/${account.group_code ?? "-"}` +
      ` -> ${guess.statement}/${guess.groupCode ?? "-"}` +
      ` (${guess.confidence}${nowMapped ? ", confirmed" : ", still for review"})`,
  );

  if (apply) {
    await pool.query(
      `update accounts
          set statement = $2, group_code = $3, cf_category = $4, is_mapped = $5
        where id = $1 and is_mapped = false`,
      [account.id, guess.statement, guess.groupCode, guess.cfCategory, nowMapped],
    );
  }
}

console.log(
  `\n${changed} of ${accounts.length} unconfirmed account(s) would change.` +
    (apply ? " Applied." : " Re-run with --apply to write them."),
);
await pool.end();

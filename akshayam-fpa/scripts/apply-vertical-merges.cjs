/**
 * Re-applies the client's confirmed vertical mapping.
 * Safe to re-run: tags already merged are simply skipped.
 *   node --env-file-if-exists=.env.local scripts/apply-vertical-merges.cjs
 */
const pg = require("pg");

const MAP = [
  ["Other Services", "COMMON"], ["EC", "ECM"], ["LC", "CMRGA"], ["MC", "CFC"],
  ["Litigation Related Secretarial", "RRG"], ["HR compliance management", "HRCM"],
  ["REGULATORY", "AIF"], ["Process and accounts", "COMMON"], ["Litigation", "DLR"],
  ["LEGAL (REG)", "AIF"], ["Legal & AIF", "AIF"], ["GIFT and Support", "AIF"],
  ["NCLT", "DLR"], ["Governance Assurance & Diligence", "GADD"],
];

(async () => {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const { rows: [e] } = await c.query("select id from entities where slug='rbjv'");

  const has = await c.query("select id from verticals where entity_id=$1 and code='HRCM'", [e.id]);
  if (has.rowCount === 0) {
    await c.query(`insert into verticals (entity_id, code, name, sort_order, needs_review)
                   values ($1,'HRCM','HR Compliance Management',85,false)`, [e.id]);
    console.log("+ created vertical HRCM");
  }

  for (const [rawName, code] of MAP) {
    const s = await c.query("select id from verticals where entity_id=$1 and name=$2", [e.id, rawName]);
    const t = await c.query("select id from verticals where entity_id=$1 and code=$2", [e.id, code]);
    if (s.rowCount === 0 || t.rowCount === 0 || s.rows[0].id === t.rows[0].id) continue;

    const src = s.rows[0].id, tgt = t.rows[0].id;
    await c.query("begin");
    try {
      await c.query("update vertical_aliases set vertical_id=$2 where entity_id=$3 and vertical_id=$1", [src, tgt, e.id]);
      let moved = 0;
      for (const tbl of ["gl_entries", "invoice_lines", "payments", "ar_open_items"]) {
        const r = await c.query(`update ${tbl} set vertical_id=$2 where entity_id=$3 and vertical_id=$1`, [src, tgt, e.id]);
        moved += r.rowCount ?? 0;
      }
      await c.query("delete from verticals where id=$1 and entity_id=$2", [src, e.id]);
      await c.query("commit");
      console.log(`  ${String(moved).padStart(5)} rows  "${rawName}" -> ${code}`);
    } catch (err) { await c.query("rollback"); console.log("  ! " + rawName + ": " + err.message); }
  }

  const left = await c.query("select name from verticals where entity_id=$1 and needs_review order by name", [e.id]);
  console.log("\nStill flagged: " + (left.rowCount ? left.rows.map(r => r.name).join(", ") : "none"));
  await c.end();
})().catch(e => { console.error("ERR", e.message); process.exit(1); });

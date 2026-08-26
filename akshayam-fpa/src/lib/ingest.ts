import type { PoolClient } from "pg";
import { transaction } from "@/lib/db";
import { suggestMapping } from "@/lib/mapping";
import type { GlParseResult } from "@/lib/parse/gl";
import type { TbParseResult } from "@/lib/parse/tb";
import type {
  ArParseResult,
  CreditNoteParseResult,
  InvoiceParseResult,
  PaymentParseResult,
} from "@/lib/parse/sales";
import type { RetainerParseResult } from "@/lib/parse/retainers";

/**
 * Committing a parsed file into the database.
 *
 * Re-uploads are idempotent by *period*, not by file: committing a general
 * ledger for Apr-Jun deletes whatever was previously stored for Apr-Jun and
 * replaces it. That is what makes a re-opened month safe to re-upload, and it
 * is why every commit runs in a single transaction - a half-replaced period
 * would be worse than either version on its own.
 */

export interface CommitResult {
  uploadId: number;
  rowsInserted: number;
  newAccounts: string[];
  newVerticals: string[];
  needsReview: string[];
}

/** Insert rows in chunks small enough to stay under Postgres' parameter limit. */
async function bulkInsert(
  client: PoolClient,
  table: string,
  columns: string[],
  rows: unknown[][],
): Promise<number> {
  if (rows.length === 0) return 0;
  const maxParams = 60_000;
  const perRow = columns.length;
  const chunkSize = Math.max(1, Math.floor(maxParams / perRow));
  let inserted = 0;

  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const chunk = rows.slice(offset, offset + chunkSize);
    const values: unknown[] = [];
    const placeholders = chunk
      .map((row) => {
        const slots = row.map((value) => {
          values.push(value);
          return `$${values.length}`;
        });
        return `(${slots.join(",")})`;
      })
      .join(",");

    const result = await client.query(
      `insert into ${table} (${columns.join(",")}) values ${placeholders}`,
      values,
    );
    inserted += result.rowCount ?? chunk.length;
  }

  return inserted;
}

/** Find or create ledger accounts, auto-suggesting a mapping for new ones. */
async function resolveAccounts(
  client: PoolClient,
  entityId: number,
  accounts: Map<string, string | null>,
): Promise<{ ids: Map<string, number>; created: string[]; needsReview: string[] }> {
  const ids = new Map<string, number>();
  const created: string[] = [];
  const needsReview: string[] = [];

  for (const [name, zohoType] of accounts) {
    const existing = await client.query<{
      id: number;
      zoho_type: string | null;
      is_mapped: boolean;
    }>("select id, zoho_type, is_mapped from accounts where entity_id = $1 and name = $2", [
      entityId,
      name,
    ]);

    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      ids.set(name, row.id);

      // A general ledger without an account_type column forces a name-only
      // guess. If a later file (typically the trial balance) does carry the
      // type, upgrade the guess - but never overwrite a mapping a human has
      // already confirmed.
      if (!row.is_mapped && zohoType && !row.zoho_type) {
        const better = suggestMapping(name, zohoType);
        await client.query(
          `update accounts
              set zoho_type = $2, statement = $3, group_code = $4,
                  cf_category = $5, is_mapped = $6
            where id = $1`,
          [
            row.id,
            zohoType,
            better.statement,
            better.groupCode,
            better.cfCategory,
            better.confidence === "high" && better.statement !== "none",
          ],
        );
        if (better.confidence === "low" || better.statement === "none") needsReview.push(name);
      } else if (!row.is_mapped) {
        needsReview.push(name);
      }
      continue;
    }

    const guess = suggestMapping(name, zohoType);
    const inserted = await client.query<{ id: number }>(
      `insert into accounts (entity_id, name, zoho_type, statement, group_code, cf_category, is_mapped)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning id`,
      [
        entityId,
        name,
        zohoType,
        guess.statement,
        guess.groupCode,
        guess.cfCategory,
        guess.confidence === "high" && guess.statement !== "none",
      ],
    );

    ids.set(name, inserted.rows[0].id);
    created.push(name);
    if (guess.confidence === "low" || guess.statement === "none") needsReview.push(name);
  }

  return { ids, created, needsReview };
}

/**
 * Reduce a reporting tag to a comparable form.
 *
 * The same vertical is written differently depending on which Zoho report it
 * came from: the ledger says "Corporate Formation & Secretarial Compliances
 * (CFC)" while the invoice salesperson says "Corporate Formation & Secretarial
 * Compliances", and "Partner's contribution" turns up as "Partner Contribution".
 * Dropping the trailing code, punctuation, case and plural endings makes those
 * the same string. It deliberately does NOT do fuzzy matching - "Governance
 * Assurance & Diligence" and "Governance Assurance & Due Diligence" stay
 * different, because guessing between them is the client's call.
 */
function normaliseTag(raw: string): string {
  return raw
    .replace(/\s*\([^)]*\)\s*$/, "") // drop a trailing "(CFC)" style code
    .toLowerCase()
    .replace(/[''´]/g, "") // possessives: partner's -> partners
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((word) => (word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word))
    .join(" ");
}

/**
 * Resolve raw Zoho reporting tags to canonical verticals.
 *
 * Tags are free text and get renamed between years, so every raw value is
 * looked up through vertical_aliases first, then by code, then by normalised
 * name. Anything still unrecognised becomes its own vertical flagged
 * needs_review rather than being guessed into an existing one: folding "NCLT"
 * into "Disputes, Litigation & Resolution" may well be right, but that is the
 * client's call, not ours.
 */
async function resolveVerticals(
  client: PoolClient,
  entityId: number,
  codes: Iterable<string>,
): Promise<{ ids: Map<string, number>; created: string[] }> {
  const ids = new Map<string, number>();
  const created: string[] = [];

  for (const rawCode of codes) {
    const alias = await client.query<{ vertical_id: number }>(
      "select vertical_id from vertical_aliases where entity_id = $1 and raw_code = $2",
      [entityId, rawCode],
    );
    if (alias.rows.length > 0) {
      ids.set(rawCode, alias.rows[0].vertical_id);
      continue;
    }

    // A tag that exactly matches a canonical code needs no alias row.
    const exact = await client.query<{ id: number }>(
      "select id from verticals where entity_id = $1 and upper(code) = upper($2)",
      [entityId, rawCode],
    );
    if (exact.rows.length > 0) {
      ids.set(rawCode, exact.rows[0].id);
      continue;
    }

    // Same vertical, different wording. Match on the normalised name, and on
    // the normalised form of any alias already recorded, so a decision made
    // once on the ledger carries over to the invoice and AR reports.
    const wanted = normaliseTag(rawCode);
    const candidates = await client.query<{ id: number; label: string }>(
      `select v.id, v.name as label from verticals v where v.entity_id = $1
       union all
       select a.vertical_id as id, a.raw_code as label
         from vertical_aliases a where a.entity_id = $1`,
      [entityId],
    );

    const matched = new Set(
      candidates.rows.filter((c) => normaliseTag(c.label) === wanted).map((c) => c.id),
    );

    if (matched.size === 1) {
      const verticalId = [...matched][0];
      await client.query(
        "insert into vertical_aliases (entity_id, raw_code, vertical_id) values ($1, $2, $3) on conflict do nothing",
        [entityId, rawCode, verticalId],
      );
      ids.set(rawCode, verticalId);
      continue;
    }

    const inserted = await client.query<{ id: number }>(
      `insert into verticals (entity_id, code, name, sort_order, needs_review)
       values ($1, $2, $2, 900, true)
       returning id`,
      [entityId, rawCode],
    );
    await client.query(
      "insert into vertical_aliases (entity_id, raw_code, vertical_id) values ($1, $2, $3)",
      [entityId, rawCode, inserted.rows[0].id],
    );
    ids.set(rawCode, inserted.rows[0].id);
    created.push(rawCode);
  }

  return { ids, created };
}

interface FileMeta {
  originalName: string;
  byteSize: number;
  sha256: string;
  storedPath?: string | null;
}

async function createUpload(
  client: PoolClient,
  entityId: number,
  kind: string,
  meta: FileMeta,
  periodStart: string | null,
  periodEnd: string | null,
  rowCount: number,
  notes: unknown,
): Promise<number> {
  const result = await client.query<{ id: number }>(
    `insert into uploads
       (entity_id, kind, original_name, stored_path, byte_size, sha256,
        period_start, period_end, row_count, status, notes)
     values ($1, $2::upload_kind, $3, $4, $5, $6, $7, $8, $9, 'committed', $10)
     returning id`,
    [
      entityId,
      kind,
      meta.originalName,
      meta.storedPath ?? null,
      meta.byteSize,
      meta.sha256,
      periodStart,
      periodEnd,
      rowCount,
      JSON.stringify(notes ?? {}),
    ],
  );
  return result.rows[0].id;
}

/* ============================================================
   General ledger
   ============================================================ */

export async function commitGeneralLedger(
  entityId: number,
  parsed: GlParseResult,
  meta: FileMeta,
): Promise<CommitResult> {
  return transaction(async (client) => {
    const { ids: accountIds, created: newAccounts, needsReview } = await resolveAccounts(
      client,
      entityId,
      parsed.accounts,
    );
    const { ids: verticalIds, created: newVerticals } = await resolveVerticals(
      client,
      entityId,
      parsed.verticals,
    );

    const uploadId = await createUpload(
      client,
      entityId,
      "gl",
      meta,
      parsed.periodStart,
      parsed.periodEnd,
      parsed.rows.length,
      { detected: parsed.detected, warnings: parsed.warnings },
    );

    // Replace the period wholesale.
    if (parsed.periodStart && parsed.periodEnd) {
      await client.query(
        `update uploads set status = 'superseded'
          where entity_id = $1 and kind = 'gl' and status = 'committed' and id <> $2
            and period_start >= $3 and period_end <= $4`,
        [entityId, uploadId, parsed.periodStart, parsed.periodEnd],
      );
      await client.query(
        "delete from gl_entries where entity_id = $1 and txn_date between $2 and $3 and upload_id <> $4",
        [entityId, parsed.periodStart, parsed.periodEnd, uploadId],
      );
    }

    const rowsInserted = await bulkInsert(
      client,
      "gl_entries",
      [
        "entity_id", "upload_id", "txn_date", "account_id", "vertical_id",
        "description", "txn_type", "txn_number", "reference", "contact_name",
        "debit", "credit",
      ],
      parsed.rows.map((row) => [
        entityId,
        uploadId,
        row.date,
        accountIds.get(row.accountName)!,
        row.vertical ? verticalIds.get(row.vertical) ?? null : null,
        row.description,
        row.txnType,
        row.txnNumber,
        row.reference,
        row.contactName,
        row.debit,
        row.credit,
      ]),
    );

    await attributeSoleVertical(client, entityId);
    return { uploadId, rowsInserted, newAccounts, newVerticals, needsReview };
  });
}

/* ============================================================
   Opening trial balance
   ============================================================ */

export async function commitTrialBalance(
  entityId: number,
  parsed: TbParseResult,
  asOf: string,
  meta: FileMeta,
): Promise<CommitResult> {
  return transaction(async (client) => {
    const accounts = new Map(parsed.rows.map((r) => [r.accountName, r.accountType]));
    const { ids: accountIds, created: newAccounts, needsReview } = await resolveAccounts(
      client,
      entityId,
      accounts,
    );

    const uploadId = await createUpload(
      client, entityId, "opening_tb", meta, asOf, asOf, parsed.rows.length,
      { detected: parsed.detected, warnings: parsed.warnings },
    );

    await client.query("delete from opening_balances where entity_id = $1 and as_of = $2", [
      entityId,
      asOf,
    ]);

    const rowsInserted = await bulkInsert(
      client,
      "opening_balances",
      ["entity_id", "upload_id", "as_of", "account_id", "debit", "credit"],
      parsed.rows.map((row) => [
        entityId, uploadId, asOf, accountIds.get(row.accountName)!, row.debit, row.credit,
      ]),
    );

    return { uploadId, rowsInserted, newAccounts, newVerticals: [], needsReview };
  });
}

/* ============================================================
   Invoices / payments / receivables
   ============================================================ */

export async function commitInvoices(
  entityId: number,
  parsed: InvoiceParseResult,
  meta: FileMeta,
): Promise<CommitResult> {
  return transaction(async (client) => {
    const { ids: verticalIds, created: newVerticals } = await resolveVerticals(
      client, entityId, parsed.verticals,
    );

    const uploadId = await createUpload(
      client, entityId, "invoices", meta, parsed.periodStart, parsed.periodEnd,
      parsed.rows.length, { detected: parsed.detected, warnings: parsed.warnings },
    );

    if (parsed.periodStart && parsed.periodEnd) {
      await client.query(
        "delete from invoice_lines where entity_id = $1 and invoice_date between $2 and $3 and upload_id <> $4",
        [entityId, parsed.periodStart, parsed.periodEnd, uploadId],
      );
    }

    const rowsInserted = await bulkInsert(
      client,
      "invoice_lines",
      [
        "entity_id", "upload_id", "invoice_number", "invoice_date", "due_date",
        "customer_name", "vertical_id", "salesperson", "item_name", "currency",
        "exchange_rate", "amount_base", "total_base", "status",
      ],
      parsed.rows.map((row) => [
        entityId, uploadId, row.invoiceNumber, row.invoiceDate, row.dueDate,
        row.customerName, row.vertical ? verticalIds.get(row.vertical) ?? null : null,
        row.salesperson, row.itemName, row.currency, row.exchangeRate,
        row.amountBase, row.totalBase, row.status,
      ]),
    );

    await linkByInvoice(client, entityId);
    return { uploadId, rowsInserted, newAccounts: [], newVerticals, needsReview: [] };
  });
}

export async function commitPayments(
  entityId: number,
  parsed: PaymentParseResult,
  meta: FileMeta,
): Promise<CommitResult> {
  return transaction(async (client) => {
    const { ids: verticalIds, created: newVerticals } = await resolveVerticals(
      client, entityId, parsed.verticals,
    );

    const uploadId = await createUpload(
      client, entityId, "payments", meta, parsed.periodStart, parsed.periodEnd,
      parsed.rows.length, { detected: parsed.detected, warnings: parsed.warnings },
    );

    if (parsed.periodStart && parsed.periodEnd) {
      await client.query(
        "delete from payments where entity_id = $1 and payment_date between $2 and $3 and upload_id <> $4",
        [entityId, parsed.periodStart, parsed.periodEnd, uploadId],
      );
    }

    const rowsInserted = await bulkInsert(
      client,
      "payments",
      [
        "entity_id", "upload_id", "payment_number", "payment_date", "customer_name",
        "invoice_number", "vertical_id", "currency", "amount_base", "amount_foreign",
        "unallocated_base", "mode",
      ],
      parsed.rows.map((row) => [
        entityId, uploadId, row.paymentNumber, row.paymentDate, row.customerName,
        row.invoiceNumber, row.vertical ? verticalIds.get(row.vertical) ?? null : null,
        row.currency, row.amountBase, row.amountForeign, row.unallocatedBase, row.mode,
      ]),
    );

    await linkByInvoice(client, entityId);
    return { uploadId, rowsInserted, newAccounts: [], newVerticals, needsReview: [] };
  });
}

export async function commitArAging(
  entityId: number,
  parsed: ArParseResult,
  meta: FileMeta,
): Promise<CommitResult> {
  return transaction(async (client) => {
    const { ids: verticalIds, created: newVerticals } = await resolveVerticals(
      client, entityId, parsed.verticals,
    );

    const asOf = parsed.asOf!;
    const uploadId = await createUpload(
      client, entityId, "ar_aging", meta, asOf, asOf, parsed.rows.length,
      { detected: parsed.detected, warnings: parsed.warnings },
    );

    // Receivables are a snapshot: one upload per as-of date replaces it entirely.
    await client.query(
      "delete from ar_open_items where entity_id = $1 and as_of = $2 and upload_id <> $3",
      [entityId, asOf, uploadId],
    );

    const rowsInserted = await bulkInsert(
      client,
      "ar_open_items",
      [
        "entity_id", "upload_id", "as_of", "invoice_number", "invoice_date", "due_date",
        "customer_name", "vertical_id", "salesperson", "currency", "exchange_rate",
        "invoice_amount", "balance_base", "unused_credit",
      ],
      parsed.rows.map((row) => [
        entityId, uploadId, asOf, row.invoiceNumber, row.invoiceDate, row.dueDate,
        row.customerName, row.vertical ? verticalIds.get(row.vertical) ?? null : null,
        row.salesperson, row.currency, row.exchangeRate,
        row.invoiceAmount, row.balanceBase, row.unusedCredit,
      ]),
    );

    // The AR export carries no salesperson for Akshayam, so nothing here has a
    // tag of its own; a single-vertical company still attributes cleanly.
    await attributeSoleVertical(client, entityId);
    return { uploadId, rowsInserted, newAccounts: [], newVerticals, needsReview: [] };
  });
}

/* ============================================================
   Credit notes
   ============================================================ */

export async function commitCreditNotes(
  entityId: number,
  parsed: CreditNoteParseResult,
  meta: FileMeta,
): Promise<CommitResult> {
  return transaction(async (client) => {
    const { ids: verticalIds, created: newVerticals } = await resolveVerticals(
      client, entityId, parsed.verticals,
    );

    const uploadId = await createUpload(
      client, entityId, "credit_notes", meta, parsed.periodStart, parsed.periodEnd,
      parsed.rows.length, { detected: parsed.detected, warnings: parsed.warnings },
    );

    if (parsed.periodStart && parsed.periodEnd) {
      await client.query(
        "delete from credit_notes where entity_id = $1 and credit_note_date between $2 and $3 and upload_id <> $4",
        [entityId, parsed.periodStart, parsed.periodEnd, uploadId],
      );
    }

    const rowsInserted = await bulkInsert(
      client,
      "credit_notes",
      [
        "entity_id", "upload_id", "credit_note_number", "credit_note_date", "customer_name",
        "vertical_id", "status", "currency", "exchange_rate", "cn_amount_base",
        "cn_total_base", "invoice_number", "is_primary_row",
      ],
      parsed.rows.map((row) => [
        entityId, uploadId, row.creditNoteNumber, row.creditNoteDate, row.customerName,
        row.vertical ? verticalIds.get(row.vertical) ?? null : null,
        row.status, row.currency, row.exchangeRate, row.amountBase,
        row.totalBase, row.invoiceNumber, row.isPrimaryRow,
      ]),
    );

    await linkByInvoice(client, entityId);
    return { uploadId, rowsInserted, newAccounts: [], newVerticals, needsReview: [] };
  });
}

/* ============================================================
   Cross-linking by invoice number
   ============================================================ */

/**
 * A company that operates one vertical has nothing to allocate.
 *
 * Akshayam tags its ledger five ways but runs a single business line, and its
 * sales exports carry no tag column at all. Leaving those rows null makes every
 * revenue and receivables page warn about amounts "not attributed to a
 * vertical" when there is only one place they could go.
 *
 * The single vertical must be confirmed (needs_review = false) before this
 * applies: a company whose first upload happened to carry one tag has not
 * decided anything yet, and guessing on its behalf is what the review screen
 * exists to prevent.
 */
async function attributeSoleVertical(client: PoolClient, entityId: number): Promise<void> {
  const sole = await client.query<{ id: number }>(
    `select max(id) as id from verticals
      where entity_id = $1 and is_active and not needs_review
     having count(*) = 1`,
    [entityId],
  );
  if (sole.rowCount === 0) return;

  const verticalId = sole.rows[0].id;
  for (const table of [
    "gl_entries", "invoice_lines", "payments", "ar_open_items",
    "credit_notes", "payment_allocations", "retainer_revenue",
  ]) {
    await client.query(
      `update ${table} set vertical_id = $2 where entity_id = $1 and vertical_id is null`,
      [entityId, verticalId],
    );
  }
}

/** Invoice numbers prefixed RI- are reimbursement recharges, not fee income. */
const REIMBURSEMENT_PREFIX = "RI-%";

/**
 * Fill in what the sales exports leave out.
 *
 * The Payments Received and Credit Note exports carry no reporting tag or
 * salesperson, but they do carry the invoice number - so the vertical is taken
 * from the invoice the money relates to. Collections are also flagged as
 * reimbursement or fee, which the client needs reported separately.
 *
 * Runs after any invoice, payment or credit-note commit, because either side
 * of the join may arrive first.
 */
export async function linkByInvoice(client: PoolClient, entityId: number): Promise<void> {
  await client.query(
    `update invoice_lines set is_reimbursement = (invoice_number like $2)
      where entity_id = $1 and is_reimbursement <> (invoice_number like $2)`,
    [entityId, REIMBURSEMENT_PREFIX],
  );

  await client.query(
    `update payments p set is_reimbursement = (p.invoice_number like $2)
      where p.entity_id = $1 and p.invoice_number is not null
        and p.is_reimbursement <> (p.invoice_number like $2)`,
    [entityId, REIMBURSEMENT_PREFIX],
  );

  // Take the vertical from the invoice the payment settles. Only meaningful
  // for single-invoice receipts; multi-invoice ones are handled by the
  // allocation table below, which is what the reports read.
  await client.query(
    `update payments p
        set vertical_id = i.vertical_id
       from (
         select distinct on (invoice_number) invoice_number, vertical_id
           from invoice_lines
          where entity_id = $1 and vertical_id is not null
          order by invoice_number, id
       ) i
      where p.entity_id = $1
        and p.vertical_id is distinct from i.vertical_id
        and p.invoice_number = i.invoice_number`,
    [entityId],
  );

  await rebuildPaymentAllocations(client, entityId);

  await client.query(
    `update credit_notes cn
        set vertical_id = i.vertical_id
       from (
         select distinct on (invoice_number) invoice_number, vertical_id
           from invoice_lines
          where entity_id = $1 and vertical_id is not null
          order by invoice_number, id
       ) i
      where cn.entity_id = $1
        and cn.vertical_id is null
        and cn.invoice_number = i.invoice_number`,
    [entityId],
  );

  await attributeSoleVertical(client, entityId);
}

/**
 * Rebuild the receipt-to-invoice allocations.
 *
 * A receipt clearing several invoices arrives as one row with a comma-separated
 * invoice list and a single total - Zoho gives no per-invoice applied amount.
 * Each referenced invoice therefore gets a share:
 *
 *   pro_rata  all referenced invoices are known, so split by invoice value
 *   equal     one or more is unknown, so value weighting is impossible
 *   single    one invoice, nothing to split
 *   unmatched no invoice number at all
 *
 * The reimbursement flag is evaluated per invoice number, so a receipt covering
 * both a fee invoice and an RI invoice splits correctly across the two.
 */
async function rebuildPaymentAllocations(client: PoolClient, entityId: number): Promise<void> {
  await client.query("delete from payment_allocations where entity_id = $1", [entityId]);

  await client.query(
    `insert into payment_allocations
       (entity_id, payment_id, invoice_number, vertical_id, is_reimbursement, amount_base, basis)
     with parts as (
       select p.id            as payment_id,
              p.entity_id,
              p.amount_base,
              btrim(x.inv)     as inv,
              count(*) over (partition by p.id) as n
         from payments p
         cross join lateral unnest(
           -- string_to_array('') returns an EMPTY array, which would drop the
           -- receipt entirely. A receipt with no invoice number must still
           -- produce one row so the allocations reconcile to the payments.
           case
             when nullif(btrim(p.invoice_number), '') is null then array[null]::text[]
             else string_to_array(btrim(p.invoice_number), ',')
           end
         ) as x(inv)
        where p.entity_id = $1
     ),
     joined as (
       select parts.*,
              i.vertical_id,
              coalesce(i.total_base, 0) as weight,
              (i.invoice_number is not null) as known,
              coalesce(parts.inv like $2, false) as ri
         from parts
         left join (
           select distinct on (invoice_number) invoice_number, vertical_id, total_base
             from invoice_lines
            where entity_id = $1
            order by invoice_number, id
         ) i on i.invoice_number = parts.inv
     ),
     weighted as (
       select j.*,
              sum(j.weight) over (partition by j.payment_id)                        as wsum,
              count(*) filter (where not j.known) over (partition by j.payment_id)  as unknown_count
         from joined j
     )
     select entity_id,
            payment_id,
            nullif(inv, ''),
            vertical_id,
            ri,
            case when unknown_count = 0 and wsum > 0 then amount_base * weight / wsum
                 else amount_base / n end,
            case when inv is null or inv = ''               then 'unmatched'
                 when n = 1                                 then 'single'
                 when unknown_count = 0 and wsum > 0        then 'pro_rata'
                 else 'equal' end
       from weighted`,
    [entityId, `${REIMBURSEMENT_PREFIX}`],
  );
}

/* ============================================================
   Recurring retainership revenue
   ============================================================ */

export async function commitRetainers(
  entityId: number,
  parsed: RetainerParseResult,
  meta: FileMeta,
): Promise<CommitResult> {
  return transaction(async (client) => {
    const { ids: verticalIds, created: newVerticals } = await resolveVerticals(
      client, entityId, parsed.verticals,
    );

    const uploadId = await createUpload(
      client, entityId, "retainers", meta, parsed.periodStart, parsed.periodEnd,
      parsed.rows.length, { detected: parsed.detected, warnings: parsed.warnings },
    );

    // Replace the months the file covers, so a re-issued list corrects itself
    // rather than doubling the retainer for those months.
    if (parsed.periodStart && parsed.periodEnd) {
      await client.query(
        "delete from retainer_revenue where entity_id = $1 and month between $2 and $3",
        [entityId, parsed.periodStart, parsed.periodEnd],
      );
    }

    const rowsInserted = await bulkInsert(
      client,
      "retainer_revenue",
      ["entity_id", "upload_id", "month", "customer_name", "customer_ref", "vertical_id", "amount_base"],
      parsed.rows.map((row) => [
        entityId, uploadId, row.month, row.customerName, row.customerRef,
        row.vertical ? verticalIds.get(row.vertical) ?? null : null,
        row.amountBase,
      ]),
    );

    await attributeSoleVertical(client, entityId);
    return { uploadId, rowsInserted, newAccounts: [], newVerticals, needsReview: [] };
  });
}

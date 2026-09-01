import type { PoolClient } from "pg";
import { transaction } from "@/lib/db";
import { suggestMapping } from "@/lib/mapping";
import type { GlParseResult } from "@/lib/parse/gl";
import type { TbParseResult } from "@/lib/parse/tb";
import type {
  ArParseResult,
  CreditNoteParseResult,
  InvoiceParseResult,
  ParsedOsbRow,
  PaymentParseResult,
} from "@/lib/parse/sales";
import type { BudgetParseResult } from "@/lib/parse/budget";
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
export async function resolveVerticals(
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

export interface FileMeta {
  originalName: string;
  byteSize: number;
  sha256: string;
  storedPath?: string | null;
  /** Who sent it. Carried on the meta so every commit path records it without
   *  each of them growing an extra argument. */
  uploadedBy?: number | null;
}

export async function createUpload(
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
        period_start, period_end, row_count, status, notes, uploaded_by)
     values ($1, $2::upload_kind, $3, $4, $5, $6, $7, $8, $9, 'committed', $10, $11)
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
      meta.uploadedBy ?? null,
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
    // Revenue follows the ledger, so a new ledger rebuilds the revenue
    // projection - the invoice register on its own is only draft billings.
    await projectRevenueFromLedger(client, entityId);
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

    // The export lands in the register verbatim; invoice_lines is rebuilt from
    // the ledger below. OSB rows are the one thing invoice_lines carries that
    // has no ledger behind it, so they are still written straight there.
    if (parsed.periodStart && parsed.periodEnd) {
      await client.query(
        "delete from invoice_register where entity_id = $1 and invoice_date between $2 and $3 and upload_id <> $4",
        [entityId, parsed.periodStart, parsed.periodEnd, uploadId],
      );
    }

    const rowsInserted = await bulkInsert(
      client,
      "invoice_register",
      [
        "entity_id", "upload_id", "invoice_number", "invoice_date", "due_date",
        "customer_name", "vertical_hint", "salesperson", "item_name", "currency",
        "exchange_rate", "amount_base", "total_base", "status",
      ],
      parsed.rows.map((row) => [
        entityId, uploadId, row.invoiceNumber, row.invoiceDate, row.dueDate,
        row.customerName, row.vertical ? verticalIds.get(row.vertical) ?? null : null,
        row.salesperson, row.itemName, row.currency, row.exchangeRate,
        row.amountBase, row.totalBase, row.status,
      ]),
    );

    if (parsed.osbRows) {
      await commitOsb(client, entityId, uploadId, parsed.osbRows, verticalIds);
    }

    await projectRevenueFromLedger(client, entityId);
    return { uploadId, rowsInserted, newAccounts: [], newVerticals, needsReview: [] };
  });
}

/**
 * Outside-books invoices, from the "OSB" sheet of an Invoice Details upload.
 *
 * Replaced wholesale on every upload that carries the sheet, entity-wide -
 * not scoped to a date range or to the invoice numbers in this file, the way
 * the rest of an invoice upload is. These are hand-maintained exceptions
 * rather than a period export: an invoice removed from the sheet, or one
 * that moved from overdue to paid, has to actually disappear from the old
 * side, and the sheet itself is the one place that says which invoices are
 * outside-books right now.
 *
 * invoice_lines and payments are not snapshots, so a plain replace is safe.
 * ar_open_items is - many as_of dates coexist - so only the latest one is
 * touched; commitArAging's own carry-forward (025_osb... see there) is what
 * keeps a receivable visible from one AR snapshot to the next after that.
 */
export async function commitOsb(
  client: PoolClient,
  entityId: number,
  uploadId: number,
  rows: ParsedOsbRow[],
  verticalIds: Map<string, number>,
): Promise<void> {
  await client.query("delete from invoice_lines where entity_id = $1 and is_osb", [entityId]);
  await client.query("delete from payments where entity_id = $1 and is_osb", [entityId]);

  await bulkInsert(
    client,
    "invoice_lines",
    [
      "entity_id", "upload_id", "invoice_number", "invoice_date", "customer_name",
      "vertical_id", "salesperson", "currency", "exchange_rate", "amount_base",
      "total_base", "status", "is_osb",
    ],
    rows.map((row) => [
      entityId, uploadId, row.invoiceNumber, row.invoiceDate, row.customerName,
      row.vertical ? verticalIds.get(row.vertical) ?? null : null, row.salesperson,
      "INR", 1, row.amountBase, row.amountBase, row.status, true,
    ]),
  );

  const paid = rows.filter((r) => (r.status ?? "").toLowerCase() === "paid");
  await bulkInsert(
    client,
    "payments",
    [
      "entity_id", "upload_id", "payment_date", "customer_name", "invoice_number",
      "vertical_id", "currency", "amount_base", "unallocated_base", "is_osb",
    ],
    // Dated to the invoice itself - an outside-books collection has no real
    // receipt to carry its own date.
    paid.map((row) => [
      entityId, uploadId, row.invoiceDate, row.customerName, row.invoiceNumber,
      row.vertical ? verticalIds.get(row.vertical) ?? null : null, "INR", row.amountBase, 0, true,
    ]),
  );

  const open = rows.filter((r) => (r.status ?? "").toLowerCase() !== "paid");
  const latest = await client.query<{ as_of: string | null }>(
    "select max(as_of)::text as as_of from ar_open_items where entity_id = $1",
    [entityId],
  );
  const asOf = latest.rows[0]?.as_of;
  // No AR snapshot loaded yet for this entity: an open outside-books item has
  // nothing to attach to. It still counts as revenue via invoice_lines above;
  // the first AR upload's own carry-forward logic is what picks it up.
  if (asOf) {
    await client.query(
      "delete from ar_open_items where entity_id = $1 and is_osb and as_of = $2",
      [entityId, asOf],
    );
    await bulkInsert(
      client,
      "ar_open_items",
      [
        "entity_id", "upload_id", "as_of", "invoice_number", "invoice_date", "due_date",
        "customer_name", "vertical_id", "salesperson", "currency", "exchange_rate",
        "invoice_amount", "balance_base", "unused_credit", "is_osb",
      ],
      open.map((row) => [
        entityId, uploadId, asOf, row.invoiceNumber, row.invoiceDate, row.invoiceDate,
        row.customerName, row.vertical ? verticalIds.get(row.vertical) ?? null : null,
        row.salesperson, "INR", 1, row.amountBase, row.amountBase, 0, true,
      ]),
    );
  }
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
        "delete from payments where entity_id = $1 and payment_date between $2 and $3 and upload_id <> $4 and not is_osb",
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
      "delete from ar_open_items where entity_id = $1 and as_of = $2 and upload_id <> $3 and not is_osb",
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

    // An outside-books invoice has no Zoho export to arrive in, so nothing
    // ever re-states it at this new as_of the way a real open item just did
    // above - it is carried forward from whichever snapshot last had it,
    // still open, until something (a future OSB reload marking it paid)
    // says otherwise. Skipped entirely once this is already that snapshot,
    // which a same-day re-upload would otherwise try to carry forward onto
    // itself.
    const latestOsb = await client.query<{ as_of: string }>(
      `select max(as_of) as as_of from ar_open_items where entity_id = $1 and is_osb and as_of < $2`,
      [entityId, asOf],
    );
    if (latestOsb.rows[0]?.as_of) {
      await client.query(
        `insert into ar_open_items
           (entity_id, upload_id, as_of, invoice_number, invoice_date, due_date, customer_name,
            vertical_id, salesperson, currency, exchange_rate, invoice_amount, balance_base,
            unused_credit, is_osb)
         select entity_id, $3, $2, invoice_number, invoice_date, due_date, customer_name,
                vertical_id, salesperson, currency, exchange_rate, invoice_amount, balance_base,
                unused_credit, true
           from ar_open_items
          where entity_id = $1 and is_osb and as_of = $4`,
        [entityId, asOf, uploadId, latestOsb.rows[0].as_of],
      );
    }

    // Take each open item's vertical from the invoice that raised it rather
    // than from this file's own salesperson column, so the two sales reports
    // cannot disagree. Then a single-vertical company still attributes
    // whatever is left over.
    await linkByInvoice(client, entityId);
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

    // The export lands in the register verbatim; credit_notes is rebuilt from
    // the ledger's own creditnote postings below.
    if (parsed.periodStart && parsed.periodEnd) {
      await client.query(
        "delete from credit_note_register where entity_id = $1 and credit_note_date between $2 and $3 and upload_id <> $4",
        [entityId, parsed.periodStart, parsed.periodEnd, uploadId],
      );
    }

    const rowsInserted = await bulkInsert(
      client,
      "credit_note_register",
      [
        "entity_id", "upload_id", "credit_note_number", "credit_note_date", "customer_name",
        "vertical_hint", "status", "currency", "exchange_rate", "cn_amount_base",
        "cn_total_base", "invoice_number", "is_primary_row",
      ],
      parsed.rows.map((row) => [
        entityId, uploadId, row.creditNoteNumber, row.creditNoteDate, row.customerName,
        row.vertical ? verticalIds.get(row.vertical) ?? null : null,
        row.status, row.currency, row.exchangeRate, row.amountBase,
        row.totalBase, row.invoiceNumber, row.isPrimaryRow,
      ]),
    );

    await projectRevenueFromLedger(client, entityId);
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
 * Rebuild invoice_lines from the ledger's revenue and reimbursement postings.
 *
 * The general ledger tags every revenue line with a reporting tag, and splits
 * one invoice across several where the work was shared; the Invoice Details
 * export only carries a salesperson, one vertical per invoice. Where the two
 * disagree the ledger wins - it is the source the P&L is built from - and an
 * invoice the ledger never posted is a draft, not revenue.
 *
 * So invoice_lines (everything except OSB) becomes one row per
 * (invoice, ledger tag, revenue|reimbursement) slice, carrying the ledger's
 * own rupee amount and posting date, joined to invoice_register for the
 * currency, customer and salesperson the ledger does not hold. Credit notes
 * are not rebuilt - only their vertical is re-pointed to the matching ledger
 * creditnote posting. Runs after every ledger, invoice or credit-note commit,
 * since any of the three changes the result.
 */
export async function projectRevenueFromLedger(
  client: PoolClient,
  entityId: number,
): Promise<void> {
  // OSB rows have no ledger behind them by definition - leave them be.
  await client.query(
    "delete from invoice_lines where entity_id = $1 and not is_osb",
    [entityId],
  );

  await client.query(
    `insert into invoice_lines
       (entity_id, upload_id, invoice_number, invoice_date, due_date, customer_name,
        vertical_id, salesperson, item_name, currency, exchange_rate,
        amount_base, total_base, status, is_reimbursement)
     select g.entity_id,
            min(g.upload_id)                                             as upload_id,
            g.txn_number                                                 as invoice_number,
            g.txn_date                                                   as invoice_date,
            max(reg.due_date)                                            as due_date,
            coalesce(max(reg.customer_name), '(not in invoice register)') as customer_name,
            g.vertical_id,
            max(reg.salesperson)                                         as salesperson,
            max(reg.item_name)                                           as item_name,
            coalesce(max(reg.currency), 'INR')                           as currency,
            coalesce(max(reg.exchange_rate), 1)                          as exchange_rate,
            sum(g.credit - g.debit)                                      as amount_base,
            sum(g.credit - g.debit)                                      as total_base,
            max(reg.status)                                              as status,
            bool_or(a.group_code = 'reimbursements')                     as is_reimbursement
       from gl_entries g
       join accounts a on a.id = g.account_id
       left join lateral (
         select r.due_date, r.customer_name, r.salesperson, r.item_name,
                r.currency, r.exchange_rate, r.status
           from invoice_register r
          where r.entity_id = g.entity_id and r.invoice_number = g.txn_number
          order by r.id
          limit 1
       ) reg on true
      where g.entity_id = $1
        and g.txn_type = 'invoice'
        and a.group_code in ('revenue', 'reimbursements')
        and g.txn_number is not null
      group by g.entity_id, g.txn_number, g.txn_date, g.vertical_id, a.group_code
     having sum(g.credit - g.debit) <> 0`,
    [entityId],
  );

  // Credit notes the same way: one row per (credit note, ledger tag,
  // revenue|reimbursement) slice, carrying the ledger's own value and posting
  // date. Every slice is is_primary_row - each holds its own tag's share and
  // they sum to the credit note total, which is what the revenue queries add
  // up. A credit note the ledger never posted deducts from nothing.
  await client.query("delete from credit_notes where entity_id = $1", [entityId]);

  await client.query(
    `insert into credit_notes
       (entity_id, upload_id, credit_note_number, credit_note_date, customer_name,
        vertical_id, status, currency, exchange_rate, cn_amount_base, cn_total_base,
        invoice_number, is_primary_row, is_reimbursement)
     select g.entity_id,
            min(g.upload_id)                                             as upload_id,
            g.txn_number                                                 as credit_note_number,
            g.txn_date                                                   as credit_note_date,
            coalesce(max(reg.customer_name), '(not in credit note register)') as customer_name,
            g.vertical_id,
            max(reg.status)                                              as status,
            coalesce(max(reg.currency), 'INR')                           as currency,
            coalesce(max(reg.exchange_rate), 1)                          as exchange_rate,
            sum(g.debit - g.credit)                                      as cn_amount_base,
            sum(g.debit - g.credit)                                      as cn_total_base,
            max(reg.invoice_number)                                      as invoice_number,
            true                                                        as is_primary_row,
            bool_or(a.group_code = 'reimbursements')                     as is_reimbursement
       from gl_entries g
       join accounts a on a.id = g.account_id
       left join lateral (
         select r.customer_name, r.status, r.currency, r.exchange_rate, r.invoice_number
           from credit_note_register r
          where r.entity_id = g.entity_id and r.credit_note_number = g.txn_number
          order by r.id
          limit 1
       ) reg on true
      where g.entity_id = $1
        and g.txn_type = 'creditnote'
        and a.group_code in ('revenue', 'reimbursements')
        and g.txn_number is not null
      group by g.entity_id, g.txn_number, g.txn_date, g.vertical_id, a.group_code
     having sum(g.debit - g.credit) <> 0`,
    [entityId],
  );

  await linkByInvoice(client, entityId);
}

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
  // invoice_lines and credit_notes no longer have is_reimbursement set from the
  // RI- prefix here: projectRevenueFromLedger sets it per row from the ledger
  // account the posting hit, which is right even when a mixed document puts
  // some lines on a reimbursement account and some on a revenue account.
  // Payments carry no ledger posting of their own, so the prefix still decides.
  await client.query(
    `update payments p set is_reimbursement = (p.invoice_number like $2)
      where p.entity_id = $1 and p.invoice_number is not null
        and p.is_reimbursement <> (p.invoice_number like $2)`,
    [entityId, REIMBURSEMENT_PREFIX],
  );

  // Take the vertical from the invoice the payment settles. Only meaningful
  // for single-invoice receipts; multi-invoice ones are handled by the
  // allocation table below, which is what the reports read.
  /*
    An invoice raised under one vertical and later split across several -
    022/023's slice-vertical corrections are the first case of this - has
    more than one distinct vertical_id among its invoice_lines rows. The
    plain lookup below deliberately excludes those: "one row, one vertical"
    is what makes distinct on safe, and forcing a split invoice through it
    would collapse the split back onto whichever vertical sorts first,
    silently undoing the correction for every table that follows it.
  */
  await client.query(
    `update payments p
        set vertical_id = i.vertical_id
       from (
         select distinct on (invoice_number) invoice_number, vertical_id
           from (
             select il.invoice_number, il.vertical_id, il.id
               from invoice_lines il
               join (
                 select invoice_number, count(distinct vertical_id) as n_verticals
                   from invoice_lines
                  where entity_id = $1 and vertical_id is not null
                  group by invoice_number
               ) n on n.invoice_number = il.invoice_number and n.n_verticals = 1
              where il.entity_id = $1 and il.vertical_id is not null
           ) x
          order by invoice_number, id
       ) i
      where p.entity_id = $1
        and p.vertical_id is distinct from i.vertical_id
        and p.invoice_number = i.invoice_number`,
    [entityId],
  );

  /*
    A split invoice's payment rows are matched by rank instead: the same
    upload that split the invoice duplicated the payment row alongside it,
    each copy carrying the amount that belongs to one share of the split (see
    the credit-note-value precedent in 025 - the figure that ties a document
    to a specific line is the one already sitting on that row, not a share
    invented by dividing a total). Ranking both sides by amount and pairing
    rank-for-rank lines a payment up with the invoice line its own amount
    corresponds to, largest with largest, without needing a column that
    names the pairing directly.
  */
  await client.query(
    `update payments p
        set vertical_id = m.vertical_id
       from (
         select pr.payment_id, pr.rnk, il.vertical_id
           from (
             select id as payment_id, invoice_number,
                    row_number() over (partition by invoice_number order by amount_base desc, id) as rnk
               from payments
              where entity_id = $1 and invoice_number is not null
           ) pr
           join (
             select invoice_number, vertical_id,
                    row_number() over (partition by invoice_number order by amount_base desc, id) as rnk
               from invoice_lines
              where entity_id = $1
                and invoice_number in (
                      select invoice_number from invoice_lines where entity_id = $1
                      group by invoice_number having count(distinct vertical_id) > 1)
           ) il on il.invoice_number = pr.invoice_number and il.rnk = pr.rnk
       ) m
      where p.entity_id = $1 and p.id = m.payment_id
        and p.vertical_id is distinct from m.vertical_id`,
    [entityId],
  );

  /**
   * One invoice, one vertical, decided in one place.
   *
   * Neither sales-side export carries a reporting tag: Invoice Details offers
   * salesperson_name and AR Aging offers Salesperson, so both reports reach
   * the vertical by parsing it out of a person's name. Only the general
   * ledger carries the tag itself. Two exports parsing two salesperson
   * columns can disagree - the AR report may name a different person than the
   * invoice does, or omit the column entirely, as Akshayam's does - and then
   * the same invoice sits under one vertical on Revenue and another on
   * Receivables.
   *
   * So the invoice register decides, and receivables follow it. Re-assigning
   * a client to a new salesperson in Zoho can then no longer move their debt
   * without also moving the revenue that raised it.
   *
   * An invoice in no uploaded register keeps whatever the AR file implied,
   * which is the best answer still available for it.
   */
  /*
    Excludes split invoices, same reason as the payments lookup above: AR
    Aging already carries its own Salesperson-derived vertical per row, and
    for a split invoice that is one row per share (the AR export repeats the
    invoice once per cost-centre split, same as Invoice Details does) - the
    correct answer for each row is already sitting on it. Forcing all of them
    onto one vertical from a single-row lookup would erase the split AR
    itself already shows.
  */
  await client.query(
    `update ar_open_items a
        set vertical_id = i.vertical_id
       from (
         select distinct on (invoice_number) invoice_number, vertical_id
           from (
             select il.invoice_number, il.vertical_id, il.id
               from invoice_lines il
               join (
                 select invoice_number, count(distinct vertical_id) as n_verticals
                   from invoice_lines
                  where entity_id = $1 and vertical_id is not null
                  group by invoice_number
               ) n on n.invoice_number = il.invoice_number and n.n_verticals = 1
              where il.entity_id = $1 and il.vertical_id is not null
           ) x
          order by invoice_number, id
       ) i
      where a.entity_id = $1
        and a.vertical_id is distinct from i.vertical_id
        and a.invoice_number = i.invoice_number`,
    [entityId],
  );

  await rebuildPaymentAllocations(client, entityId);

  await client.query(
    `update credit_notes cn
        set vertical_id = i.vertical_id
       from (
         select distinct on (invoice_number) invoice_number, vertical_id
           from (
             select il.invoice_number, il.vertical_id, il.id
               from invoice_lines il
               join (
                 select invoice_number, count(distinct vertical_id) as n_verticals
                   from invoice_lines
                  where entity_id = $1 and vertical_id is not null
                  group by invoice_number
               ) n on n.invoice_number = il.invoice_number and n.n_verticals = 1
              where il.entity_id = $1 and il.vertical_id is not null
           ) x
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
     -- Most invoices carry one vertical; the plain lookup, unchanged.
     single_vertical as (
       select distinct on (invoice_number) invoice_number, vertical_id, total_base
         from (
           select il.invoice_number, il.vertical_id, il.total_base, il.id
             from invoice_lines il
             join (
               select invoice_number, count(distinct vertical_id) as n_verticals
                 from invoice_lines
                where entity_id = $1 and vertical_id is not null
                group by invoice_number
             ) n on n.invoice_number = il.invoice_number and n.n_verticals = 1
            where il.entity_id = $1
         ) x
        order by invoice_number, id
     ),
     -- An invoice split across verticals (022/023's slice corrections, or any
     -- future one) carries several rows for the same invoice_number, and the
     -- upload that split it duplicated the payment row alongside each share -
     -- see 025's reasoning for crediting a document from the amount already
     -- on its own row rather than a share invented by dividing a total.
     -- Ranking both sides by amount and pairing rank-for-rank lines a payment
     -- up with the split share its own amount corresponds to.
     split_vertical as (
       select pr.payment_id, pr.inv, il.vertical_id, il.total_base
         from (
           select payment_id, inv, amount_base,
                  row_number() over (partition by inv order by amount_base desc, payment_id) as rnk
             from parts
            where inv is not null
         ) pr
         join (
           select invoice_number, vertical_id, total_base,
                  row_number() over (partition by invoice_number order by amount_base desc, id) as rnk
             from invoice_lines
            where entity_id = $1
              and invoice_number in (
                    select invoice_number from invoice_lines where entity_id = $1
                    group by invoice_number having count(distinct vertical_id) > 1)
         ) il on il.invoice_number = pr.inv and il.rnk = pr.rnk
     ),
     joined as (
       select parts.*,
              coalesce(sv.vertical_id, s.vertical_id) as vertical_id,
              coalesce(sv.total_base, s.total_base, 0) as weight,
              (coalesce(sv.vertical_id, s.vertical_id) is not null) as known,
              coalesce(parts.inv like $2, false) as ri
         from parts
         left join single_vertical s on s.invoice_number = parts.inv
         left join split_vertical sv on sv.payment_id = parts.payment_id and sv.inv = parts.inv
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

/* ============================================================
   The planning workbook
   ============================================================ */

/**
 * Load the budgeted P&L and the Other-expenses breakdown.
 *
 * One file, three entities: the workbook budgets the group and both companies
 * on separate sheets, and they are loaded together because they are one
 * document and loading half of it would leave the consolidation disagreeing
 * with its members.
 *
 * Everything for the year is replaced rather than merged. A budget is revised
 * as a whole - a new version of the workbook restates every month - so adding
 * to what is there would leave the previous version's figures underneath.
 */
export async function commitBudget(
  parsed: BudgetParseResult,
  meta: FileMeta,
): Promise<CommitResult & { loaded: { slug: string; name: string; pnlRows: number; expenseRows: number }[] }> {
  return transaction(async (client) => {
    const fy = parsed.fyStartYear;
    const loaded: { slug: string; name: string; pnlRows: number; expenseRows: number }[] = [];
    let uploadId = 0;
    let rowsInserted = 0;

    for (const sheet of parsed.entities) {
      const entity = (
        await client.query<{ id: number; name: string }>(
          "select id, name from entities where slug = $1",
          [sheet.slug],
        )
      ).rows[0];
      // A workbook naming a company this installation does not have is not an
      // error - it is a sheet for someone else's books.
      if (!entity) continue;

      // The upload row is recorded against the first entity loaded, because an
      // upload belongs to one; the others are named in its summary.
      if (uploadId === 0) {
        uploadId = await createUpload(
          client, entity.id, "budget", meta,
          `${fy}-04-01`, `${fy + 1}-03-31`,
          parsed.entities.reduce((n, e) => n + e.pnl.length + e.expenses.length, 0),
          { detected: parsed.detected, warnings: parsed.warnings },
        );
      }

      await client.query(
        "delete from budget_pnl where entity_id = $1 and fy_start_year = $2",
        [entity.id, fy],
      );
      const pnlRows = await bulkInsert(
        client,
        "budget_pnl",
        ["entity_id", "fy_start_year", "month", "group_code", "amount"],
        sheet.pnl.map((r) => [entity.id, fy, r.month, r.groupCode, r.amount]),
      );

      await client.query(
        "delete from expense_budget_lines where entity_id = $1 and fy_start_year = $2",
        [entity.id, fy],
      );
      const expenseRows = await bulkInsert(
        client,
        "expense_budget_lines",
        ["entity_id", "fy_start_year", "head", "label", "month", "amount", "sort_order"],
        sheet.expenses.map((r) => [
          entity.id, fy, r.head, r.label, r.month, r.amount, r.sortOrder,
        ]),
      );

      rowsInserted += pnlRows + expenseRows;
      loaded.push({ slug: sheet.slug, name: entity.name, pnlRows, expenseRows });
    }

    if (loaded.length === 0) {
      throw new Error(
        "None of the sheets in this workbook match a company in this installation.",
      );
    }

    return {
      uploadId,
      rowsInserted,
      newAccounts: [],
      newVerticals: [],
      // Unrecognised budget rows are worth chasing but do not block the load.
      needsReview: parsed.entities.flatMap((e) => e.unmatched),
      loaded,
    };
  });
}

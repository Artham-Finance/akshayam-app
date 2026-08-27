import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { getEntity } from "@/lib/entity";
import {
  commitArAging,
  commitBudget,
  commitCreditNotes,
  commitGeneralLedger,
  commitInvoices,
  commitPayments,
  commitRetainers,
  commitTrialBalance,
  type CommitResult,
} from "@/lib/ingest";
import { parseBudgetWorkbook } from "@/lib/parse/budget";
import { parseGeneralLedger } from "@/lib/parse/gl";
import { parseRetainers } from "@/lib/parse/retainers";
import { parseArAging, parseCreditNotes, parseInvoices, parsePayments } from "@/lib/parse/sales";
import { parseTrialBalance, type TbBasis } from "@/lib/parse/tb";
import { apiGuard } from "@/lib/auth/dal";

export const runtime = "nodejs";
// Ledger exports can be large and parsing is CPU-bound; give it room.
export const maxDuration = 300;

const KINDS = [
  "gl", "opening_tb", "invoices", "payments", "ar_aging", "credit_notes", "retainers",
  "budget",
] as const;
type Kind = (typeof KINDS)[number];

function isKind(value: string): value is Kind {
  return (KINDS as readonly string[]).includes(value);
}

/**
 * Refuse a double-entry file whose two sides disagree.
 *
 * Both parsers used to warn and load it anyway, and a warning on the upload
 * screen is read once while the balance sheet is read every week. Neither the
 * reporting layer nor anyone reading it can recover the missing side, so the
 * gap would surface later as a statement that does not tie for a reason nobody
 * could trace back to the file. A rupee of tolerance covers rounding in the
 * export itself.
 */
function requireBalanced(what: string, debit: number, credit: number, remedy: string) {
  const gap = Math.abs(debit - credit);
  if (gap <= 1) return;
  throw new Error(
    `This ${what} does not balance: debits ${debit.toFixed(2)} against credits ` +
      `${credit.toFixed(2)}, a difference of ${gap.toFixed(2)}. ${remedy}`,
  );
}

export async function POST(request: Request) {
  const { user, denied } = await apiGuard("data.upload");
  if (denied) return denied;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected a multipart form upload." }, { status: 400 });
  }

  const file = form.get("file");
  const kindRaw = String(form.get("kind") ?? "");
  const asOf = form.get("asOf") ? String(form.get("asOf")) : null;

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file was received." }, { status: 400 });
  }
  if (!isKind(kindRaw)) {
    return NextResponse.json(
      { error: `Unknown report type "${kindRaw}".` },
      { status: 400 },
    );
  }
  // .xls is accepted because some Zoho reports (Payments Received) still
  // download as legacy BIFF; it is converted during parsing.
  if (!/\.(xlsx|xlsm|xls)$/i.test(file.name)) {
    return NextResponse.json(
      { error: "Please upload an Excel file (.xlsx or .xls) exported from Zoho Books." },
      { status: 400 },
    );
  }

  const bytes = Buffer.from(new Uint8Array(await file.arrayBuffer()));
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  // Keep the original file so a number can always be traced back to its source.
  const uploadDir = process.env.UPLOAD_DIR ?? "./storage/uploads";
  let storedPath: string | null = null;
  try {
    await mkdir(uploadDir, { recursive: true });
    storedPath = join(uploadDir, `${sha256.slice(0, 12)}-${file.name.replace(/[^\w.\-]/g, "_")}`);
    await writeFile(storedPath, bytes);
  } catch {
    storedPath = null; // not fatal - the parsed data is what matters
  }

  const meta = {
    originalName: file.name,
    byteSize: bytes.byteLength,
    sha256,
    storedPath,
    uploadedBy: user.id,
  };

  try {
    const entity = await getEntity();
    // The budget is the one file that is not a company's own book: the
    // planning workbook budgets the group and both companies on separate
    // sheets, and loads all of them whichever view it was dropped on.
    if (entity.isGroup && kindRaw !== "budget") {
      return NextResponse.json(
        { error: "The consolidated view has no books of its own. Switch to a company first." },
        { status: 400 },
      );
    }

    let result: CommitResult;
    let warnings: string[] = [];
    let detected: unknown;
    let summary: Record<string, unknown> = {};

    switch (kindRaw) {
      case "gl": {
        const parsed = await parseGeneralLedger(bytes);
        requireBalanced(
          "general ledger",
          parsed.totalDebit,
          parsed.totalCredit,
          "A ledger whose two sides disagree is missing rows or has double-read them. " +
            "Re-export the full period from Zoho Books with every account included.",
        );
        result = await commitGeneralLedger(entity.id, parsed, meta);
        warnings = parsed.warnings;
        detected = parsed.detected;
        summary = {
          period: [parsed.periodStart, parsed.periodEnd],
          accounts: parsed.accounts.size,
          verticals: [...parsed.verticals],
        };
        break;
      }
      case "opening_tb": {
        if (!asOf) {
          return NextResponse.json(
            { error: "An 'as at' date is required for a trial balance upload." },
            { status: 400 },
          );
        }
        // A period trial balance carries opening, movement and closing columns.
        // "Opening" is the default because that is what seeds the balance sheet;
        // reading the Debit/Credit columns instead would take period movements
        // and call them balances.
        const basisRaw = String(form.get("basis") ?? "opening");
        const basis: TbBasis =
          basisRaw === "closing" || basisRaw === "movement" ? basisRaw : "opening";

        const parsed = await parseTrialBalance(bytes, basis);
        requireBalanced(
          "trial balance",
          parsed.totalDebit,
          parsed.totalCredit,
          "A trial balance that does not balance cannot seed a balance sheet that does. " +
            `Check that the ${basis} column was the right one to read and that no account was left out.`,
        );
        result = await commitTrialBalance(entity.id, parsed, asOf, meta);
        warnings = parsed.warnings;
        detected = { ...parsed.detected, basis: parsed.basis, available: parsed.available };
        summary = {
          asOf,
          basis: parsed.basis,
          totalDebit: parsed.totalDebit,
          totalCredit: parsed.totalCredit,
        };
        break;
      }
      case "invoices": {
        const parsed = await parseInvoices(bytes);
        result = await commitInvoices(entity.id, parsed, meta);
        warnings = parsed.warnings;
        detected = parsed.detected;
        summary = { period: [parsed.periodStart, parsed.periodEnd], verticals: [...parsed.verticals] };
        break;
      }
      case "payments": {
        const parsed = await parsePayments(bytes);
        result = await commitPayments(entity.id, parsed, meta);
        warnings = parsed.warnings;
        detected = parsed.detected;
        summary = { period: [parsed.periodStart, parsed.periodEnd] };
        break;
      }
      case "credit_notes": {
        const parsed = await parseCreditNotes(bytes);
        result = await commitCreditNotes(entity.id, parsed, meta);
        warnings = parsed.warnings;
        detected = parsed.detected;
        summary = {
          period: [parsed.periodStart, parsed.periodEnd],
          totalCredited: parsed.totalCredited,
        };
        break;
      }
      case "budget": {
        const parsed = await parseBudgetWorkbook(bytes);
        const committed = await commitBudget(parsed, meta);
        result = committed;
        warnings = parsed.warnings;
        detected = parsed.detected;
        summary = {
          financialYear: `FY ${parsed.fyStartYear}-${String(parsed.fyStartYear + 1).slice(2)}`,
          loaded: committed.loaded.map(
            (l) => `${l.name}: ${l.pnlRows} P&L, ${l.expenseRows} expense line(s)`,
          ),
        };
        break;
      }
      case "retainers": {
        const parsed = await parseRetainers(bytes);
        result = await commitRetainers(entity.id, parsed, meta);
        warnings = parsed.warnings;
        detected = parsed.detected;
        summary = {
          period: [parsed.periodStart, parsed.periodEnd],
          verticals: [...parsed.verticals],
        };
        break;
      }
      case "ar_aging": {
        const parsed = await parseArAging(bytes, asOf);
        result = await commitArAging(entity.id, parsed, meta);
        warnings = parsed.warnings;
        detected = parsed.detected;
        summary = { asOf: parsed.asOf, totalOutstanding: parsed.totalOutstanding };
        break;
      }
      default:
        return NextResponse.json({ error: "Unhandled report type." }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      kind: kindRaw,
      fileName: file.name,
      rowsInserted: result.rowsInserted,
      newAccounts: result.newAccounts,
      newVerticals: result.newVerticals,
      needsReview: result.needsReview,
      warnings,
      detected,
      summary,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error while reading the file.";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}

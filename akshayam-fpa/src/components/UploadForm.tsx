"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { dateLabel } from "@/lib/format";

/**
 * Upload cards, one per Zoho report.
 *
 * Each card says exactly where in Zoho Books the file comes from, because the
 * most common failure is uploading the right-sounding wrong report. After a
 * file lands we show what was detected - period, columns, new accounts - so
 * the numbers can be sanity-checked before anyone opens the dashboard.
 */

export interface UploadKindInfo {
  kind: string;
  title: string;
  zohoPath: string;
  blurb: string;
  cadence: string;
  needsAsOf: boolean;
  asOfLabel?: string;
  lastUpload?: {
    fileName: string;
    rowCount: number | null;
    periodStart: string | null;
    periodEnd: string | null;
    createdAt: string;
  } | null;
}

interface UploadResponse {
  ok?: true;
  error?: string;
  rowsInserted?: number;
  newAccounts?: string[];
  newVerticals?: string[];
  needsReview?: string[];
  warnings?: string[];
  detected?: { sheetName?: string; columns?: string[]; verticalColumn?: string | null; layout?: string };
  summary?: Record<string, unknown>;
}

export function UploadForm({ kinds }: { kinds: UploadKindInfo[] }) {
  return (
    <div className="space-y-3">
      {kinds.map((info) => (
        <UploadCard key={info.kind} info={info} />
      ))}
    </div>
  );
}

function UploadCard({ info }: { info: UploadKindInfo }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UploadResponse | null>(null);
  const [asOf, setAsOf] = useState("");
  const [dragging, setDragging] = useState(false);

  async function send(file: File) {
    if (info.needsAsOf && !asOf) {
      setResult({ error: `Please choose the ${info.asOfLabel ?? "as at"} date first.` });
      return;
    }

    setBusy(true);
    setResult(null);

    const body = new FormData();
    body.set("file", file);
    body.set("kind", info.kind);
    if (asOf) body.set("asOf", asOf);

    try {
      const response = await fetch("/api/upload", { method: "POST", body });
      const data: UploadResponse = await response.json();
      setResult(data);
      if (response.ok) router.refresh();
    } catch {
      setResult({ error: "The upload failed before it reached the server. Is the app still running?" });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const succeeded = result?.ok === true;

  return (
    <section
      className={clsx(
        "rounded-card border bg-surface transition-colors",
        dragging ? "border-navy bg-navy-tint/40" : "border-line",
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file) void send(file);
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-4 p-4 sm:p-5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[14px] font-semibold text-ink">{info.title}</h3>
            <span className="rounded-full bg-surface-sunk px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-faint">
              {info.cadence}
            </span>
          </div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">{info.blurb}</p>
          <p className="mt-1.5 text-[11.5px] text-ink-faint">
            In Zoho Books: <span className="text-ink-muted">{info.zohoPath}</span> &rarr; Export as XLSX
          </p>

          {info.lastUpload && (
            <p className="mt-2 text-[11.5px] text-ink-faint">
              Last upload: {info.lastUpload.fileName} &middot;{" "}
              {info.lastUpload.rowCount?.toLocaleString("en-IN") ?? "?"} rows
              {info.lastUpload.periodStart && (
                <>
                  {" "}
                  &middot; {dateLabel(info.lastUpload.periodStart)} to{" "}
                  {dateLabel(info.lastUpload.periodEnd)}
                </>
              )}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          {info.needsAsOf && (
            <label className="flex items-center gap-2 text-[11.5px] text-ink-muted">
              {info.asOfLabel ?? "As at"}
              <input
                type="date"
                value={asOf}
                onChange={(e) => setAsOf(e.target.value)}
                className="rounded-md border border-line bg-surface px-2 py-1 text-[12px] text-ink"
              />
            </label>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className={clsx(
              "rounded-md px-3.5 py-2 text-[12.5px] font-medium transition-colors",
              busy
                ? "cursor-wait bg-surface-sunk text-ink-faint"
                : "bg-navy text-ink-invert hover:bg-navy-deep",
            )}
          >
            {busy ? "Reading file…" : "Choose file"}
          </button>
          <span className="text-[11px] text-ink-faint">or drop it here</span>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xlsm,.xls"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void send(file);
            }}
          />
        </div>
      </div>

      {result && (
        <div
          className={clsx(
            "border-t px-4 py-3 text-[12.5px] sm:px-5",
            succeeded ? "border-positive/20 bg-positive-tint" : "border-negative/20 bg-negative-tint",
          )}
        >
          {succeeded ? (
            <div className="space-y-1.5 text-positive">
              <p className="font-semibold">
                Loaded {result.rowsInserted?.toLocaleString("en-IN")} rows.
              </p>
              {result.detected?.sheetName && (
                <p className="opacity-90">
                  Read from sheet &ldquo;{result.detected.sheetName}&rdquo;
                  {result.detected.layout && ` (${result.detected.layout} layout)`}
                  {result.detected.verticalColumn
                    ? `, verticals from the "${result.detected.verticalColumn}" column.`
                    : "."}
                </p>
              )}
              {!!result.newAccounts?.length && (
                <p className="opacity-90">
                  {result.newAccounts.length} new ledger account
                  {result.newAccounts.length === 1 ? "" : "s"} discovered.
                </p>
              )}
              {!!result.newVerticals?.length && (
                <p className="opacity-90">
                  New verticals: {result.newVerticals.join(", ")}.
                </p>
              )}
              {!!result.needsReview?.length && (
                <p className="font-medium">
                  {result.needsReview.length} account
                  {result.needsReview.length === 1 ? "" : "s"} could not be classified
                  confidently &mdash;{" "}
                  <a href="/settings/accounts" className="underline">
                    review the mapping
                  </a>{" "}
                  before sharing the report.
                </p>
              )}
              {result.warnings?.map((warning) => (
                <p key={warning} className="text-caution">
                  {warning}
                </p>
              ))}
            </div>
          ) : (
            <p className="text-negative">{result.error}</p>
          )}
        </div>
      )}
    </section>
  );
}

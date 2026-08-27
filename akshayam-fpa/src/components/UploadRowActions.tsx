"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";

/**
 * Download the file, or withdraw the upload.
 *
 * Removing takes the rows it loaded with it, so it asks first. The
 * confirmation is the file's own name rather than a generic "are you sure":
 * the register lists the same report several times over, and the only thing
 * that distinguishes the row you meant from the one above it is which file it
 * was.
 */
export function UploadRowActions({
  id,
  fileName,
  hasFile,
  canDelete,
}: {
  id: number;
  fileName: string;
  hasFile: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/upload/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "The upload could not be removed.");
        setBusy(false);
        return;
      }
      router.refresh();
    } catch {
      setError("The request failed before it reached the server.");
      setBusy(false);
    }
  }

  if (confirming) {
    return (
      <div className="flex flex-col items-end gap-1">
        <span className="text-[11.5px] text-ink-muted">
          Remove {fileName} and everything it loaded?
        </span>
        <div className="flex gap-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={remove}
            className={clsx(
              "whitespace-nowrap rounded-md px-2.5 py-1 text-[12px] font-medium",
              busy ? "cursor-wait bg-surface-sunk text-ink-faint" : "bg-negative text-ink-invert",
            )}
          >
            {busy ? "Removing…" : "Remove"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirming(false)}
            className="whitespace-nowrap rounded-md border border-line px-2.5 py-1 text-[12px] font-medium text-ink-muted hover:bg-surface-sunk"
          >
            Keep
          </button>
        </div>
        {error && <span className="text-[11.5px] text-negative">{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex items-center justify-end gap-1.5">
      {hasFile ? (
        <a
          href={`/api/upload/download?id=${id}`}
          className="whitespace-nowrap rounded-md border border-line px-2.5 py-1 text-[12px] font-medium text-ink-muted hover:bg-surface-sunk"
        >
          Download
        </a>
      ) : (
        <span className="text-[12px] text-ink-faint">not kept</span>
      )}
      {canDelete && (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="whitespace-nowrap rounded-md border border-line px-2.5 py-1 text-[12px] font-medium text-ink-faint hover:border-negative/40 hover:text-negative"
        >
          Remove
        </button>
      )}
    </div>
  );
}

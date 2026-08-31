import clsx from "clsx";
import Link from "next/link";
import type { ReactNode } from "react";

/** Page title block with an optional right-hand control area. */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight text-ink sm:text-[26px]">
          {title}
        </h1>
        {subtitle && <p className="mt-1 text-[13px] text-ink-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({
  children,
  className,
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section
      className={clsx(
        "rounded-card border border-line bg-surface shadow-[0_1px_2px_rgba(22,38,60,0.04)]",
        padded && "p-4 sm:p-5",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function CardTitle({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-[13px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
        {children}
      </h2>
      {hint && <span className="text-[11px] text-ink-faint">{hint}</span>}
    </div>
  );
}

/** Quiet informational strip. Tone carries meaning, so keep it accurate. */
export function Notice({
  tone = "info",
  title,
  children,
  action,
}: {
  tone?: "info" | "caution" | "negative" | "positive";
  title?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  const tones = {
    info: "border-navy-tint-strong bg-navy-tint text-navy",
    caution: "border-caution/25 bg-caution-tint text-caution",
    negative: "border-negative/25 bg-negative-tint text-negative",
    positive: "border-positive/25 bg-positive-tint text-positive",
  } as const;

  return (
    <div className={clsx("rounded-card border px-4 py-3 text-[13px]", tones[tone])}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {title && <p className="font-semibold">{title}</p>}
          <div className={clsx(title && "mt-0.5", "leading-relaxed opacity-90")}>{children}</div>
        </div>
        {action}
      </div>
    </div>
  );
}

/** Shown when a section has no data yet, always with the next step spelled out. */
export function EmptyState({
  title,
  children,
  href,
  cta,
}: {
  title: string;
  children: ReactNode;
  href?: string;
  cta?: string;
}) {
  return (
    <Card className="py-12 text-center">
      <p className="text-[15px] font-semibold text-ink">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-ink-muted">
        {children}
      </p>
      {href && cta && (
        <Link
          href={href}
          className="mt-5 inline-flex items-center rounded-md bg-navy px-4 py-2 text-[13px] font-medium text-ink-invert transition-colors hover:bg-navy-deep"
        >
          {cta}
        </Link>
      )}
    </Card>
  );
}

/**
 * The skin of a headline tile, one entry per tone.
 *
 * The wash is the tile's own meaning, not decoration: a positive tile is green
 * because the figure is good news, an overdue tile amber because it is not.
 * Kept pale, so six of them side by side still read as a page of figures.
 */
const TILE_TONES = {
  ink: {
    surface: "border-navy-tint-strong bg-linear-to-br from-tile-navy to-surface",
    hover: "group-hover:border-navy/35",
    accent: "bg-navy/40",
    label: "text-navy/60",
    value: "text-navy-deep",
    note: "text-ink-muted",
    divider: "border-navy-tint-strong",
  },
  positive: {
    surface: "border-positive/25 bg-linear-to-br from-tile-positive to-surface",
    hover: "group-hover:border-positive/45",
    accent: "bg-positive/45",
    label: "text-positive/70",
    value: "text-positive",
    note: "text-ink-muted",
    divider: "border-positive/20",
  },
  caution: {
    surface: "border-caution/25 bg-linear-to-br from-tile-caution to-surface",
    hover: "group-hover:border-caution/45",
    accent: "bg-caution/45",
    label: "text-caution/75",
    value: "text-caution",
    note: "text-ink-muted",
    divider: "border-caution/20",
  },
  negative: {
    surface: "border-negative/25 bg-linear-to-br from-tile-negative to-surface",
    hover: "group-hover:border-negative/45",
    accent: "bg-negative/45",
    label: "text-negative/70",
    value: "text-negative",
    note: "text-ink-muted",
    divider: "border-negative/20",
  },
} as const;

/**
 * A headline figure, optionally opening the documents behind it.
 *
 * A management report is only trusted as far as its figures can be traced, so
 * where a tile has a document trail it becomes a link and says so. The active
 * tile is marked, because otherwise a table appearing below a row of six
 * numbers gives no clue which one it belongs to.
 */
export function KpiTile({
  label,
  value,
  note,
  tone = "ink",
  href,
  active = false,
  cumulative,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  tone?: "ink" | "positive" | "caution" | "negative";
  href?: string;
  active?: boolean;
  /** the year-to-date figure behind a single week or month */
  cumulative?: { label: string; value: ReactNode };
}) {
  const skin = TILE_TONES[tone];

  const body = (
    <section
      className={clsx(
        "relative h-full overflow-hidden rounded-card border bg-surface p-4 shadow-[0_1px_2px_rgba(22,38,60,0.04)] transition-colors sm:p-5",
        skin.surface,
        href && skin.hover,
        active && "ring-1 ring-navy/20",
      )}
    >
      <span aria-hidden className={clsx("absolute inset-x-0 top-0 h-[3px]", skin.accent)} />
      <div className="flex items-baseline justify-between gap-2">
        <p className={clsx("text-[11px] font-medium uppercase tracking-[0.1em]", skin.label)}>
          {label}
        </p>
        {href && (
          <span className="text-[10.5px] font-medium text-navy opacity-0 transition-opacity group-hover:opacity-100">
            {active ? "Close" : "View"}
          </span>
        )}
      </div>
      <p
        className={clsx(
          "num mt-2 text-[22px] font-semibold tracking-tight sm:text-[26px]",
          skin.value,
        )}
      >
        {value}
      </p>
      {note && <p className={clsx("mt-1 text-[11.5px]", skin.note)}>{note}</p>}
      {cumulative && (
        <p
          className={clsx(
            "mt-2 flex items-baseline justify-between gap-2 border-t pt-2 text-[11.5px]",
            skin.divider,
          )}
        >
          <span className={skin.label}>{cumulative.label}</span>
          <span className={clsx("num font-medium", skin.note)}>{cumulative.value}</span>
        </p>
      )}
    </section>
  );

  if (!href) return body;
  return (
    <Link href={href} scroll={false} className="group block">
      {body}
    </Link>
  );
}

/**
 * Download the page as a spreadsheet.
 *
 * A plain anchor, not next/link: this is a file, and the client router would
 * try to navigate to it.
 */
export function DownloadExcel({ href, label = "Download Excel" }: { href: string; label?: string }) {
  return (
    <a
      href={href}
      className="whitespace-nowrap rounded-md border border-line px-2.5 py-1.5 text-[12px] font-medium text-ink-muted hover:bg-surface-sunk"
    >
      {label}
    </a>
  );
}

/**
 * The documents behind a figure.
 *
 * Capped, because a drill-down that tries to render seven thousand invoice
 * lines helps nobody. The cap is stated with the full count so the reader knows
 * they are looking at part of it, and the ordering puts the rows worth seeing
 * first.
 */
export function DrillPanel({
  title,
  subtitle,
  closeHref,
  downloadHref,
  shown,
  total,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  closeHref: string;
  /** Excel export of the same drill, uncapped */
  downloadHref?: string;
  shown: number;
  total: number;
  children: ReactNode;
}) {
  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4 pb-3 sm:px-5">
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
            {title}
          </h2>
          {subtitle && <p className="mt-1 text-[12px] text-ink-muted">{subtitle}</p>}
          {shown < total && (
            <p className="mt-1 text-[12px] text-caution">
              Showing {shown} of {total} — the Excel download has all {total}.
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {downloadHref && (
            // A plain anchor, not next/link: this is a file download, and the
            // client router would try to navigate to it.
            <a
              href={downloadHref}
              className="whitespace-nowrap rounded-md bg-navy px-2.5 py-1.5 text-[12px] font-medium text-ink-invert hover:bg-navy-deep"
            >
              Download Excel
            </a>
          )}
          <Link
            href={closeHref}
            scroll={false}
            className="whitespace-nowrap rounded-md border border-line px-2.5 py-1.5 text-[12px] font-medium text-ink-muted hover:bg-surface-sunk"
          >
            Close
          </Link>
        </div>
      </div>
      {children}
    </Card>
  );
}

/**
 * Shown on a page that only means something for a single company.
 *
 * Uploading, account mapping and vertical housekeeping all act on one set of
 * books. The consolidation has none of its own, so rather than showing an
 * empty screen that looks broken, say what to do instead.
 */
export function CompanyOnly({
  what,
  slice = false,
  companies = 2,
}: {
  what: string;
  slice?: boolean;
  /**
   * How many real companies the slice draws from - RAJA is one vertical from
   * each of two companies, a single-vertical slice like CMRGA is one vertical
   * of one. The copy below reads wrong for the other case if this is left at
   * its RAJA-shaped default.
   */
  companies?: number;
}) {
  if (slice) {
    const whatLower = what.charAt(0).toLowerCase() + what.slice(1);
    // Every slice today draws from one company or two (RAJA), and prose reads
    // better than a numeral at that size - "2 companies" looks like a stat,
    // "two companies" like a sentence.
    const word = companies === 1 ? "one" : companies === 2 ? "two" : String(companies);
    const whose = companies === 1 ? "one company’s" : `${word} companies’`;
    const across = companies === 1 ? "part of a company" : `part of ${word} companies`;
    return (
      <EmptyState title="Not available on a partner view">
        {what} is a whole-company statement. This view is a slice of {whose} books
        {companies > 1 ? " - one vertical of each" : ""}, and {whatLower} drawn across{" "}
        {across} would be a figure with nothing behind it. Revenue, collections,
        receivables and the P&amp;L all work here; switch to a company for the rest.
      </EmptyState>
    );
  }
  return (
    <EmptyState title="Not available on the consolidated view">
      {what} belongs to a single company&apos;s books, and the group consolidates two sets of
      them. Switch to RBJV &amp; Associates or Akshayam in the company picker at the top of the
      page, and this screen comes back.
    </EmptyState>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("animate-pulse rounded bg-surface-sunk", className)} />;
}

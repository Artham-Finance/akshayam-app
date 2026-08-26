import { Card, PageHeader } from "@/components/ui";
import Link from "next/link";

/**
 * Placeholder for sections that are designed and scheduled but not yet built.
 * It states what the section will contain and what it needs, so the gap is
 * legible rather than looking like a broken link.
 */
export function ComingNext({
  title,
  summary,
  willShow,
  needs,
}: {
  title: string;
  summary: string;
  willShow: string[];
  needs: string;
}) {
  return (
    <>
      <PageHeader title={title} subtitle={summary} />
      <Card className="max-w-2xl">
        <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-caution">
          Next to be built
        </p>
        <h2 className="mt-2 text-[15px] font-semibold text-ink">This section will show</h2>
        <ul className="mt-3 space-y-2 text-[13px] leading-relaxed text-ink-muted">
          {willShow.map((item) => (
            <li key={item} className="flex gap-2">
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink-faint" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 border-t border-line pt-3 text-[12.5px] text-ink-muted">
          <span className="font-medium text-ink">Needs:</span> {needs}{" "}
          <Link href="/upload" className="text-navy hover:underline">
            Upload it here
          </Link>
          .
        </p>
      </Card>
    </>
  );
}

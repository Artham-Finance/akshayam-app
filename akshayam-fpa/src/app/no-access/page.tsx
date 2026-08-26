import Link from "next/link";
import { requireUser } from "@/lib/auth/dal";
import { ROLE_LABEL } from "@/lib/auth/permissions";

export const dynamic = "force-dynamic";

export const metadata = { title: "No access — Group Management Reporting" };

/** Plain-English names for the permissions, so the page says something useful. */
const NEEDED: Record<string, string> = {
  "reports.view": "view the reports",
  "reports.export": "download reports",
  "data.upload": "upload data",
  "accounts.map": "change account mapping",
  "verticals.manage": "manage verticals",
  "expenses.record": "record expenses",
  "users.manage": "manage people",
  "entities.manage": "manage companies",
};

export default async function NoAccessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const raw = params.need;
  const need = Array.isArray(raw) ? raw[0] : raw;
  const what = need ? NEEDED[need] : undefined;

  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-[17px] font-semibold tracking-tight text-ink">
        You don&rsquo;t have access to this
      </h1>
      <p className="mt-3 text-[13px] leading-relaxed text-ink-muted">
        {what ? (
          <>
            Your account isn&rsquo;t allowed to {what}. You are signed in as{" "}
            <span className="font-medium text-ink">{user.email}</span> with the{" "}
            {ROLE_LABEL[user.role]} role.
          </>
        ) : (
          <>
            Your account isn&rsquo;t allowed to see this page. You are signed in as{" "}
            <span className="font-medium text-ink">{user.email}</span> with the{" "}
            {ROLE_LABEL[user.role]} role.
          </>
        )}
      </p>
      <p className="mt-2 text-[12px] text-ink-faint">
        Ask an administrator if you need this.
      </p>
      <Link
        href="/"
        className="mt-6 inline-block rounded-md bg-navy px-3.5 py-2 text-[12px] font-semibold text-ink-invert hover:bg-navy-deep"
      >
        Back to the overview
      </Link>
    </div>
  );
}

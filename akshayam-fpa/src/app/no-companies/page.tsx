import { requireUser } from "@/lib/auth/dal";
import { ROLE_LABEL } from "@/lib/auth/permissions";

export const dynamic = "force-dynamic";

export const metadata = { title: "No companies yet — Group Management Reporting" };

/**
 * The signed-in-but-granted-nothing case.
 *
 * Distinct from /no-access on purpose: that one means "your role is too
 * narrow", this one means "nobody has said which books are yours". They need
 * different things asked of the administrator, so they say different things.
 */
export default async function NoCompaniesPage() {
  const user = await requireUser();

  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-[17px] font-semibold tracking-tight text-ink">
        No companies yet
      </h1>
      <p className="mt-3 text-[13px] leading-relaxed text-ink-muted">
        Your account works — you are signed in as{" "}
        <span className="font-medium text-ink">{user.email}</span> with the{" "}
        {ROLE_LABEL[user.role]} role — but nobody has granted you access to a
        company, so there is nothing to show yet.
      </p>
      <p className="mt-2 text-[12px] text-ink-faint">
        Ask an administrator to add you under Settings &rarr; People.
      </p>
    </div>
  );
}

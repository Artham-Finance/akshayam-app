import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/dal";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Sign in — Group Management Reporting" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params.next;
  const wanted = Array.isArray(raw) ? raw[0] : raw;
  // Same rule as the action: only ever a path on this site.
  const next = wanted && wanted.startsWith("/") && !wanted.startsWith("//") ? wanted : "/";

  if (await getCurrentUser()) redirect(next);

  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-sm flex-col justify-center">
      <div className="mb-7 text-center">
        <h1 className="text-[17px] font-semibold tracking-tight text-ink">
          Group Management Reporting
        </h1>
        <p className="mt-1 text-[12px] text-ink-muted">
          Sign in to continue.
        </p>
      </div>

      <div className="rounded-lg border border-line bg-surface p-6 shadow-sm">
        <LoginForm next={next} />
      </div>

      <p className="mt-5 text-center text-[11px] leading-relaxed text-ink-faint">
        Accounts are created by an administrator. If you need access, or have
        forgotten your password, ask them to set one for you.
      </p>
    </div>
  );
}

import Image from "next/image";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/dal";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Sign in — Akshayam" };

// The three things this reporting suite is for. Shown on the brand panel in
// place of a longer feature list - one line each, no marketing copy.
const FEATURES = ["Core Financials", "Financial Planning & Analysis", "Vertical Performance"];

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

  // Signed out there is no nav and no footer worth keeping, so the page takes
  // the whole window - breaking out of the padded <main> in the root layout.
  return (
    <div className="fixed inset-0 z-50 grid overflow-y-auto bg-surface lg:grid-cols-2">
      {/* Brand panel - hidden on narrow screens where the form is all that fits. */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-navy-deep px-12 py-14 text-ink-invert lg:flex">
        <div className="pointer-events-none absolute -right-24 top-20 h-96 w-96 rounded-full border border-white/10" />
        <div className="pointer-events-none absolute -right-44 top-4 h-[34rem] w-[34rem] rounded-full border border-white/5" />

        <div className="relative">
          <div className="flex items-center gap-3">
            <Image
              src="/logo.jpeg"
              alt="Akshayam"
              width={134}
              height={76}
              className="h-12 w-auto rounded-lg bg-white/95 object-contain p-1.5"
              priority
            />
            <div>
              <p className="text-[15px] font-semibold uppercase tracking-wide">
                Akshayam
              </p>
              <p className="text-[11px] uppercase tracking-[0.16em] text-ink-invert/55">
                Management Reporting
              </p>
            </div>
          </div>

          <h1 className="mt-12 max-w-md text-[34px] font-bold leading-[1.15] tracking-tight">
            One source of truth for{" "}
            <span className="text-[#6aa9d9]">
              Financial Reporting &amp; Analysis
            </span>
          </h1>
        </div>

        <ul className="relative border-t border-white/10">
          {FEATURES.map((f) => (
            <li
              key={f}
              className="flex items-center gap-3 border-b border-white/10 py-4 text-[14px] font-semibold"
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#6aa9d9]/15 text-[#6aa9d9]">
                <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                  <path
                    fillRule="evenodd"
                    d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4l3.8 3.8 6.8-6.8a1 1 0 0 1 1.4 0Z"
                    clipRule="evenodd"
                  />
                </svg>
              </span>
              {f}
            </li>
          ))}
        </ul>

        <p className="relative text-[11px] text-ink-invert/40">
          &copy; {new Date().getFullYear()} Akshayam. All rights reserved.
        </p>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center px-6 py-12 sm:px-12">
        <div className="w-full max-w-sm">
          {/* The brand panel is hidden below lg, so carry a compact mark here. */}
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <Image
              src="/logo.jpeg"
              alt="Akshayam"
              width={134}
              height={76}
              className="h-10 w-auto object-contain"
              priority
            />
            <p className="text-[15px] font-semibold uppercase tracking-wide text-ink">
              Akshayam
            </p>
          </div>

          <h2 className="text-[26px] font-bold tracking-tight text-ink">Welcome back</h2>
          <p className="mt-1.5 text-[13px] text-ink-muted">
            Sign in to your Akshayam account
          </p>

          <div className="mt-8">
            <LoginForm next={next} />
          </div>

          <div className="mt-6 flex items-center gap-2 text-[11px] text-ink-faint">
            <span className="h-1.5 w-1.5 rounded-full bg-positive" />
            Secure login &middot; Your session is encrypted and protected
          </div>

          <p className="mt-6 text-[11px] leading-relaxed text-ink-faint">
            Accounts are created by an administrator. If you need access, or have
            forgotten your password, ask them to set one for you.
          </p>
        </div>
      </div>
    </div>
  );
}

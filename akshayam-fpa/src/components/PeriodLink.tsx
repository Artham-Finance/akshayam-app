"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import clsx from "clsx";

/**
 * A control that sets the global reporting period to a specific date range,
 * then soft-refreshes. Used where a figure on the page is itself a period -
 * a month bar, a quarter heading - so clicking it takes the whole report to
 * that window, the way the header picker would.
 */
export function PeriodLink({
  from,
  to,
  className,
  activeClassName,
  active = false,
  children,
}: {
  from: string;
  to: string;
  className?: string;
  activeClassName?: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const go = async () => {
    await fetch("/api/reporting-period", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ preset: "custom", from, to }),
    });
    startTransition(() => router.refresh());
  };

  return (
    <button
      type="button"
      onClick={go}
      disabled={pending}
      className={clsx(className, active && activeClassName, pending && "opacity-60")}
    >
      {children}
    </button>
  );
}

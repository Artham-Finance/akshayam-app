import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { apiGuard } from "@/lib/auth/dal";
import { PRESET_IDS, type PeriodCookie } from "@/lib/period-presets";
import { PERIOD_COOKIE } from "@/lib/reporting-period";

export const runtime = "nodejs";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PRESETS = new Set<string>(PRESET_IDS);

/**
 * Set the global reporting period - the header date-range picker.
 *
 * The value is stored as-is; the single-financial-year confinement is applied
 * when it is read (`getReportingPeriod`), the same way `/api/entity` stores a
 * slug and lets `getEntity` enforce access. A malformed body is refused so a
 * bad cookie can never be written from here.
 */
export async function POST(request: Request) {
  const { denied } = await apiGuard("reports.view");
  if (denied) return denied;

  let body: Partial<PeriodCookie>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const preset = String(body.preset ?? "");
  if (!PRESETS.has(preset)) {
    return NextResponse.json({ error: "Unknown period." }, { status: 400 });
  }

  let value: PeriodCookie;
  if (preset === "custom") {
    const { from, to } = body;
    if (
      typeof from !== "string" ||
      typeof to !== "string" ||
      !ISO_DATE.test(from) ||
      !ISO_DATE.test(to) ||
      from > to
    ) {
      return NextResponse.json(
        { error: "A custom range needs a from and to date, from on or before to." },
        { status: 400 },
      );
    }
    value = { preset: "custom", from, to };
  } else {
    value = { preset: preset as PeriodCookie["preset"] };
  }

  const store = await cookies();
  store.set(PERIOD_COOKIE, JSON.stringify(value), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  return NextResponse.json({ ok: true });
}

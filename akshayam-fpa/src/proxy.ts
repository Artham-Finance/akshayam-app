import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic sign-in check.
 *
 * This runs before every render and does exactly one thing: send a visitor
 * with no session cookie to the login page, so nine report pages do not each
 * have to start by discovering they have no user.
 *
 * It deliberately does not touch the database and does not decide anything
 * else. Proxy runs on prefetches too, so a query here would multiply across
 * every hovered link; and a cookie's mere presence says nothing about whether
 * it is valid, who it belongs to, or what they may do. Those questions are
 * settled in `src/lib/auth/dal.ts`, against the database, on every request.
 * Deleting this file would cost a redirect, not a boundary.
 *
 * `middleware.ts` is the deprecated name for this convention in Next 16.
 */

const SESSION_COOKIE = "fpa_session";

/** Reachable without a session. Everything else needs one. */
const PUBLIC_PATHS = ["/login"];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  if (request.cookies.get(SESSION_COOKIE)) {
    return NextResponse.next();
  }

  // API routes get a 401 rather than a redirect: a fetch that follows a
  // redirect to the login page reads as a confusing 200 full of HTML.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  }

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  // Bring them back where they were headed once they have signed in.
  if (pathname !== "/") url.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(url);
}

export const config = {
  // Static assets and the favicon are excluded; without this the redirect
  // would also swallow the CSS and JS the login page itself needs.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};

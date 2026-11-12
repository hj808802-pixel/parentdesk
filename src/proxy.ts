import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, pickLocale, splitLocale } from "@/lib/i18n/locales";

// Locale routing. English has no prefix (/items); other UI languages have one (/ja/items).
// Internally every page lives under app/[locale], so English paths are rewritten to
// /en/... and /en/... itself redirects to the bare path (one canonical URL per page).
// First visit without a prefix: the pd_locale cookie wins, then Accept-Language.

// Addresses other services post to with their own secret; no browser cookie is involved.
const SERVER_TO_SERVER = ["/api/hook/", "/api/inbound", "/api/billing/webhook", "/api/cron/"];

// A write that a page on another site made the browser send (cookies ride along on some
// of those): refused. Requests without an Origin header (scripts, servers) carry no
// browser cookie by accident and are left to the route's own checks.
function crossSiteWrite(req: NextRequest): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return false;
  const path = req.nextUrl.pathname;
  if (SERVER_TO_SERVER.some((p) => path.startsWith(p))) return false;
  const origin = req.headers.get("origin");
  if (!origin) return req.headers.get("sec-fetch-site") === "cross-site";
  let host = "";
  try {
    host = new URL(origin).host;
  } catch {
    return true;
  }
  const own = [req.headers.get("host"), req.headers.get("x-forwarded-host"), req.nextUrl.host].filter(Boolean);
  return !own.includes(host);
}

export function proxy(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return crossSiteWrite(req) ? NextResponse.json({ ok: false, error: "bad_origin" }, { status: 403 }) : NextResponse.next();
  }
  const url = req.nextUrl.clone();
  const { locale, path } = splitLocale(url.pathname);

  if (locale === DEFAULT_LOCALE) {
    url.pathname = path;
    return NextResponse.redirect(url, 308);
  }
  if (locale) return NextResponse.next();

  const cookieLocale = req.cookies.get(LOCALE_COOKIE)?.value;
  const chosen = isLocale(cookieLocale) ? cookieLocale : pickLocale(req.headers.get("accept-language"));
  if (chosen !== DEFAULT_LOCALE) {
    url.pathname = `/${chosen}${path === "/" ? "" : path}`;
    return NextResponse.redirect(url, 307);
  }
  url.pathname = `/${DEFAULT_LOCALE}${path === "/" ? "" : path}`;
  return NextResponse.rewrite(url);
}

export const config = {
  // Pages (locale routing) and API routes (cross-site check); not the console page, Next
  // internals or files with an extension.
  matcher: ["/((?!admin|_next|.*\\..*).*)"],
};

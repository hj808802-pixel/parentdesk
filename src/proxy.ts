import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, pickLocale, splitLocale } from "@/lib/i18n/locales";

// Locale routing. English has no prefix (/items); other UI languages have one (/ja/items).
// Internally every page lives under app/[locale], so English paths are rewritten to
// /en/... and /en/... itself redirects to the bare path (one canonical URL per page).
// First visit without a prefix: the pd_locale cookie wins, then Accept-Language.

export function proxy(req: NextRequest) {
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
  // Pages only: skip API routes, Next internals and any file with an extension.
  matcher: ["/((?!api|_next|.*\\..*).*)"],
};

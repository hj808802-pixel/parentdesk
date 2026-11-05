import { LOCALE_COOKIE, isLocale, pickLocale, type Locale } from "./i18n/locales";

// Small helpers for route handlers that redirect back into the app.

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  const m = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(header);
  return m ? decodeURIComponent(m[1]) : null;
}

export function localeOf(req: Request): Locale {
  const fromCookie = readCookie(req, LOCALE_COOKIE);
  return isLocale(fromCookie) ? fromCookie : pickLocale(req.headers.get("accept-language"));
}

// The public origin: the configured site URL in production (OAuth redirect URIs must match
// it exactly), the request's own origin otherwise.
export function siteOrigin(req: Request): string {
  const configured = (process.env.NEXT_PUBLIC_SITE_URL ?? "").trim().replace(/\/$/, "");
  if (configured && process.env.NODE_ENV === "production") return configured;
  return new URL(req.url).origin;
}

export function redirectTo(req: Request, path: string, headers: Record<string, string> = {}, status = 303): Response {
  const url = new URL(path, new URL(req.url).origin);
  return new Response(null, { status, headers: { location: url.toString(), ...headers } });
}

import { authUrl, gmailEnabled, newState } from "@/lib/gmail";
import { localePath } from "@/lib/i18n/locales";
import { canUse } from "@/lib/plan";
import { localeOf, redirectTo, siteOrigin } from "@/lib/request";
import { familyFromRequest, isHttps } from "@/lib/store";

export const runtime = "nodejs";

// Step 1 of connecting Gmail: send the parent to Google's consent screen. The signed
// state is also kept in a short-lived cookie so the callback can match it.

export async function GET(req: Request) {
  const locale = localeOf(req);
  if (!gmailEnabled()) return redirectTo(req, `${localePath(locale, "/settings")}?gmail=off`);
  const rec = await familyFromRequest(req);
  if (!rec) return redirectTo(req, `${localePath(locale, "/settings")}?gmail=nofamily`);
  if (!canUse(rec, "gmail")) return redirectTo(req, `${localePath(locale, "/settings")}?gmail=plan`);
  const state = newState(rec.id);
  const cookie = `pd_gstate=${state}; Path=/api/google; Max-Age=600; HttpOnly; SameSite=Lax${isHttps(req) ? "; Secure" : ""}`;
  return new Response(null, { status: 302, headers: { location: authUrl(siteOrigin(req), state), "set-cookie": cookie } });
}

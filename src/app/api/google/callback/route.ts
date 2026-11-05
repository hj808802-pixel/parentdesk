import { encrypt } from "@/lib/crypto";
import { exchangeCode, fetchEmail, gmailEnabled, parseState } from "@/lib/gmail";
import { localePath } from "@/lib/i18n/locales";
import { localeOf, readCookie, redirectTo, siteOrigin } from "@/lib/request";
import { familyFromRequest, isHttps, saveFamily } from "@/lib/store";

export const runtime = "nodejs";

// Step 2 of connecting Gmail: Google sends the parent back with a code. We check the
// state, swap the code for a refresh token, seal it and store it on the family.

export async function GET(req: Request) {
  const locale = localeOf(req);
  const clear = `pd_gstate=; Path=/api/google; Max-Age=0; HttpOnly; SameSite=Lax${isHttps(req) ? "; Secure" : ""}`;
  const back = (status: string) => redirectTo(req, `${localePath(locale, "/settings")}?gmail=${status}`, { "set-cookie": clear });
  if (!gmailEnabled()) return back("off");

  const url = new URL(req.url);
  if (url.searchParams.get("error")) return back("denied");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const parsed = parseState(state);
  if (!code || !parsed || state !== readCookie(req, "pd_gstate")) return back("error");

  const rec = await familyFromRequest(req);
  if (!rec || rec.id !== parsed.familyId) return back("error");

  try {
    const t = await exchangeCode(code, siteOrigin(req));
    if (!t.refreshToken) return back("error");
    const email = t.email ?? (await fetchEmail(t.accessToken)) ?? "unknown";
    rec.gmail = {
      email,
      refreshToken: encrypt(t.refreshToken),
      connectedAt: new Date().toISOString(),
      lastScanAt: null,
      lastResult: null,
      processed: [],
      senders: rec.gmail?.senders ?? [],
      paused: false,
    };
    await saveFamily(rec);
    console.log(JSON.stringify({ event: "gmail_connected", family: rec.id }));
    return back("connected");
  } catch (e) {
    console.error("[google/callback]", e);
    return back("error");
  }
}

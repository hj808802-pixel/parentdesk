import { parseUnsubscribeToken } from "@/lib/digest";
import { localePath } from "@/lib/i18n/locales";
import { localeOf, redirectTo } from "@/lib/request";
import { loadFamily, saveFamily } from "@/lib/store";

export const runtime = "nodejs";

// The link at the bottom of the summary (GET, lands on Settings) and the one-click header
// that mail apps use (POST). The token is signed, so no login is needed.

async function turnOff(token: string | null): Promise<boolean> {
  const id = parseUnsubscribeToken(token);
  if (!id) return false;
  const rec = await loadFamily(id);
  if (!rec) return false;
  rec.settings.digest = false;
  await saveFamily(rec);
  return true;
}

export async function GET(req: Request) {
  const ok = await turnOff(new URL(req.url).searchParams.get("u"));
  return redirectTo(req, `${localePath(localeOf(req), "/settings")}?digest=${ok ? "off" : "badlink"}`);
}

export async function POST(req: Request) {
  const ok = await turnOff(new URL(req.url).searchParams.get("u"));
  return Response.json(ok ? { ok: true } : { ok: false, error: "bad_token" }, { status: ok ? 200 : 404 });
}

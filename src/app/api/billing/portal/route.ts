import { localePath } from "@/lib/i18n/locales";
import { billingEnabled } from "@/lib/plan";
import { allowRequest, clientIp } from "@/lib/ratelimit";
import { localeOf, siteOrigin } from "@/lib/request";
import { familyFromRequest } from "@/lib/store";
import { createPortal } from "@/lib/stripe";

export const runtime = "nodejs";

// Stripe's Customer Portal: change the card, switch monthly/yearly, cancel. Only for a
// family that has been through Checkout once (it has a customer id).

export async function POST(req: Request) {
  if (!billingEnabled()) return Response.json({ ok: false, error: "billing_off" }, { status: 404 });
  const rec = await familyFromRequest(req);
  if (!rec) return Response.json({ ok: false, error: "no_family" }, { status: 404 });
  if (!rec.billing?.customerId) return Response.json({ ok: false, error: "no_subscription" }, { status: 400 });
  const gate = allowRequest({ ip: clientIp(req), family: rec.id });
  if (!gate.ok) return Response.json({ ok: false, error: gate.reason, retry_after: gate.retryAfterSec }, { status: 429 });
  try {
    const url = await createPortal({ customerId: rec.billing.customerId, returnUrl: `${siteOrigin(req)}${localePath(localeOf(req), "/settings")}` });
    return Response.json({ ok: true, url });
  } catch (e) {
    console.error("[billing] portal", rec.id, e);
    return Response.json({ ok: false, error: "billing_error" }, { status: 502 });
  }
}

import { localePath } from "@/lib/i18n/locales";
import { billingEnabled } from "@/lib/plan";
import { allowRequest, clientIp } from "@/lib/ratelimit";
import { localeOf, siteOrigin } from "@/lib/request";
import { familyFromRequest } from "@/lib/store";
import { createCheckout, StripeError } from "@/lib/stripe";

export const runtime = "nodejs";

// Starts a Stripe Checkout for the Family plan. The browser follows the returned URL;
// Stripe sends the parent back to Settings with ?billing=success or ?billing=cancel, and
// the webhook (api/billing/webhook) records the subscription.

export async function POST(req: Request) {
  if (!billingEnabled()) return Response.json({ ok: false, error: "billing_off" }, { status: 404 });
  const rec = await familyFromRequest(req);
  if (!rec) return Response.json({ ok: false, error: "no_family" }, { status: 404 });
  const gate = allowRequest({ ip: clientIp(req), family: rec.id });
  if (!gate.ok) return Response.json({ ok: false, error: gate.reason, retry_after: gate.retryAfterSec }, { status: 429 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const interval = body.interval === "year" ? "year" : "month";
  const settings = `${siteOrigin(req)}${localePath(localeOf(req), "/settings")}`;
  try {
    const url = await createCheckout({
      familyId: rec.id,
      interval,
      customerId: rec.billing?.customerId ?? null,
      successUrl: `${settings}?billing=success`,
      cancelUrl: `${settings}?billing=cancel`,
    });
    return Response.json({ ok: true, url });
  } catch (e) {
    console.error("[billing] checkout", rec.id, e);
    const code = e instanceof StripeError ? e.code : "api";
    return Response.json({ ok: false, error: code === "no_price" ? "billing_off" : "billing_error" }, { status: code === "no_price" ? 404 : 502 });
  }
}

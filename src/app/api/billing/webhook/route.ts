import { billingEnabled } from "@/lib/plan";
import { loadFamily, saveFamily } from "@/lib/store";
import { applyStripeEvent, familyIdFromEvent, parseStripeEvent, verifyStripeSignature } from "@/lib/stripe";

export const runtime = "nodejs";

// Stripe → us. Verified with STRIPE_WEBHOOK_SECRET; events for unknown families or of
// other types are acknowledged and ignored (Stripe retries anything that is not a 2xx).

export async function POST(req: Request) {
  if (!billingEnabled()) return Response.json({ ok: false, error: "billing_off" }, { status: 404 });
  const payload = await req.text();
  if (!verifyStripeSignature(payload, req.headers.get("stripe-signature"), process.env.STRIPE_WEBHOOK_SECRET ?? "")) {
    return Response.json({ ok: false, error: "bad_signature" }, { status: 400 });
  }
  const event = parseStripeEvent(payload);
  if (!event) return Response.json({ ok: false, error: "bad_event" }, { status: 400 });

  const familyId = familyIdFromEvent(event);
  if (!familyId) {
    console.log(JSON.stringify({ event: "stripe_ignored", type: event.type, id: event.id }));
    return Response.json({ ok: true, ignored: "no_family" });
  }
  const rec = await loadFamily(familyId);
  if (!rec) return Response.json({ ok: true, ignored: "unknown_family" });
  const changed = applyStripeEvent(rec, event);
  if (changed) await saveFamily(rec);
  console.log(JSON.stringify({ event: "stripe", type: event.type, id: event.id, family: familyId, changed, status: rec.billing?.status ?? null }));
  return Response.json({ ok: true, changed });
}

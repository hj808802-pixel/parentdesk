import { createHmac, timingSafeEqual } from "node:crypto";
import { billingEnabled } from "./plan";
import type { Billing, FamilyRecord } from "./types";

// Stripe Checkout + Customer Portal + webhooks over Stripe's REST API (form-encoded, no
// SDK). The family id travels as the Checkout client_reference_id and as subscription
// metadata, so every later event finds its family without a customer index.
//
// Card data never touches this server. What we keep is in types.ts Billing.

const API = "https://api.stripe.com/v1";
const API_VERSION = "2025-08-27.basil";

export class StripeError extends Error {
  constructor(
    public code: "off" | "api" | "bad_signature" | "no_price",
    message: string,
  ) {
    super(message);
  }
}

export function priceFor(interval: "month" | "year"): string | null {
  const id = interval === "year" ? process.env.STRIPE_PRICE_YEARLY : process.env.STRIPE_PRICE_MONTHLY;
  return id?.trim() || null;
}

// Flattens { a: { b: "x" }, c: ["y"] } into Stripe's bracket form: a[b]=x, c[0]=y.
export function encodeForm(params: Record<string, unknown>, prefix = ""): URLSearchParams {
  const out = new URLSearchParams();
  const walk = (v: unknown, key: string) => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${key}[${i}]`));
    else if (typeof v === "object") for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, key ? `${key}[${k}]` : k);
    else out.append(key, String(v));
  };
  walk(params, prefix);
  return out;
}

export async function stripePost<T = Record<string, unknown>>(path: string, params: Record<string, unknown>, fetchImpl: typeof fetch = fetch): Promise<T> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new StripeError("off", "STRIPE_SECRET_KEY is not set");
  const res = await fetchImpl(`${API}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/x-www-form-urlencoded", "stripe-version": API_VERSION },
    body: encodeForm(params).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; type?: string } };
  if (!res.ok) throw new StripeError("api", body.error?.message ?? `stripe ${res.status}`);
  return body;
}

export async function createCheckout(
  opts: { familyId: string; interval: "month" | "year"; customerId?: string | null; successUrl: string; cancelUrl: string; locale?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  if (!billingEnabled()) throw new StripeError("off", "billing is off");
  const price = priceFor(opts.interval);
  if (!price) throw new StripeError("no_price", `no price for ${opts.interval}`);
  const session = await stripePost<{ url?: string }>(
    "/checkout/sessions",
    {
      mode: "subscription",
      line_items: [{ price, quantity: 1 }],
      client_reference_id: opts.familyId,
      metadata: { family: opts.familyId },
      subscription_data: { metadata: { family: opts.familyId } },
      success_url: opts.successUrl,
      cancel_url: opts.cancelUrl,
      allow_promotion_codes: true,
      billing_address_collection: "auto",
      locale: opts.locale ?? "auto",
      ...(opts.customerId ? { customer: opts.customerId } : {}),
    },
    fetchImpl,
  );
  if (!session.url) throw new StripeError("api", "checkout session without url");
  return session.url;
}

export async function createPortal(opts: { customerId: string; returnUrl: string }, fetchImpl: typeof fetch = fetch): Promise<string> {
  if (!billingEnabled()) throw new StripeError("off", "billing is off");
  const session = await stripePost<{ url?: string }>("/billing_portal/sessions", { customer: opts.customerId, return_url: opts.returnUrl }, fetchImpl);
  if (!session.url) throw new StripeError("api", "portal session without url");
  return session.url;
}

// ---- webhooks ----

// "t=1700000000,v1=abc,v1=def" → true when one v1 matches HMAC-SHA256(secret, "t.payload")
// and the timestamp is within the tolerance (replayed deliveries are rejected).
export function verifyStripeSignature(payload: string, header: string | null, secret: string, nowSec: number = Math.floor(Date.now() / 1000), toleranceSec = 300): boolean {
  if (!header || !secret) return false;
  const parts = header.split(",").map((p) => p.trim().split("="));
  const t = parts.find(([k]) => k === "t")?.[1];
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v ?? "");
  if (!t || !/^\d+$/.test(t) || sigs.length === 0) return false;
  if (Math.abs(nowSec - Number(t)) > toleranceSec) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex"));
  return sigs.some((s) => {
    const given = Buffer.from(s);
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

export type StripeEvent = { id: string; type: string; created: number; data: { object: Record<string, unknown> } };

export function parseStripeEvent(payload: string): StripeEvent | null {
  try {
    const e = JSON.parse(payload) as StripeEvent;
    return e && typeof e.id === "string" && typeof e.type === "string" && typeof e.created === "number" && e.data?.object ? e : null;
  } catch {
    return null;
  }
}

const str = (x: unknown): string | null => (typeof x === "string" && x ? x : null);
const idOf = (x: unknown): string | null => str(x) ?? str((x as { id?: unknown } | null)?.id);

// The family an event is about: subscription metadata (set at Checkout) or the Checkout
// session's client_reference_id.
export function familyIdFromEvent(e: StripeEvent): string | null {
  const o = e.data.object;
  const meta = (o.metadata ?? {}) as Record<string, unknown>;
  const id = str(meta.family) ?? str(o.client_reference_id);
  return id && /^[0-9a-f]{12}$/.test(id) ? id : null;
}

// A subscription's period end lives on the subscription in older API versions and on its
// items in newer ones.
function periodEnd(o: Record<string, unknown>): string | null {
  const direct = o.current_period_end;
  if (typeof direct === "number") return new Date(direct * 1000).toISOString();
  const items = (o.items as { data?: { current_period_end?: unknown }[] } | undefined)?.data ?? [];
  const n = items.map((i) => i.current_period_end).find((x): x is number => typeof x === "number");
  return n ? new Date(n * 1000).toISOString() : null;
}

function intervalOf(o: Record<string, unknown>): "month" | "year" | null {
  const items = (o.items as { data?: { price?: { recurring?: { interval?: unknown } }; plan?: { interval?: unknown } }[] } | undefined)?.data ?? [];
  const i = items.map((x) => x.price?.recurring?.interval ?? x.plan?.interval).find((x) => x === "month" || x === "year");
  return (i as "month" | "year" | undefined) ?? null;
}

// Applies one event to the family's billing state. Returns false when the event is not
// about billing or is older than what the record already reflects.
export function applyStripeEvent(rec: FamilyRecord, e: StripeEvent): boolean {
  const o = e.data.object;
  const at = new Date(e.created * 1000).toISOString();
  const prev = rec.billing ?? null;
  if (prev?.lastEvent === e.id) return false;
  if (prev && Date.parse(prev.updatedAt) > e.created * 1000) return false; // out of order: a newer event already applied

  if (e.type === "checkout.session.completed") {
    if (o.mode !== "subscription") return false;
    const customerId = idOf(o.customer);
    if (!customerId) return false;
    const next: Billing = {
      customerId,
      subscriptionId: idOf(o.subscription),
      status: prev?.status && prev.customerId === customerId ? prev.status : "active",
      interval: prev?.interval ?? null,
      currentPeriodEnd: prev?.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: false,
      updatedAt: at,
      lastEvent: e.id,
    };
    rec.billing = next;
    return true;
  }

  if (e.type.startsWith("customer.subscription.")) {
    const customerId = idOf(o.customer);
    if (!customerId) return false;
    const status = e.type === "customer.subscription.deleted" ? "canceled" : (str(o.status) ?? "active");
    rec.billing = {
      customerId,
      subscriptionId: idOf(o.id),
      status,
      interval: intervalOf(o) ?? prev?.interval ?? null,
      currentPeriodEnd: periodEnd(o) ?? prev?.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: Boolean(o.cancel_at_period_end),
      updatedAt: at,
      lastEvent: e.id,
    };
    return true;
  }

  return false;
}

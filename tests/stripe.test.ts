import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFamily } from "@/lib/store";
import { applyStripeEvent, createCheckout, encodeForm, familyIdFromEvent, parseStripeEvent, verifyStripeSignature, type StripeEvent } from "@/lib/stripe";

const SECRET = "whsec_test_secret";

function signed(payload: string, t: number, secret = SECRET): string {
  const v1 = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

function event(type: string, object: Record<string, unknown>, over: Partial<StripeEvent> = {}): StripeEvent {
  return { id: `evt_${Math.random().toString(16).slice(2)}`, type, created: 1_762_400_000, data: { object }, ...over };
}

describe("stripe", () => {
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
    process.env.STRIPE_PRICE_MONTHLY = "price_m";
    process.env.STRIPE_PRICE_YEARLY = "price_y";
  });
  afterEach(() => {
    for (const k of ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_MONTHLY", "STRIPE_PRICE_YEARLY"]) delete process.env[k];
  });

  it("encodes nested params the way Stripe expects", () => {
    const s = encodeForm({ mode: "subscription", line_items: [{ price: "price_m", quantity: 1 }], metadata: { family: "abc" } }).toString();
    expect(s).toBe("mode=subscription&line_items%5B0%5D%5Bprice%5D=price_m&line_items%5B0%5D%5Bquantity%5D=1&metadata%5Bfamily%5D=abc");
  });

  it("verifies webhook signatures with a tolerance", () => {
    const payload = '{"id":"evt_1","type":"ping","created":1,"data":{"object":{}}}';
    const t = 1_762_400_000;
    expect(verifyStripeSignature(payload, signed(payload, t), SECRET, t + 10)).toBe(true);
    expect(verifyStripeSignature(payload, signed(payload, t), SECRET, t + 1000)).toBe(false); // too old
    expect(verifyStripeSignature(payload, signed(payload, t, "other"), SECRET, t)).toBe(false);
    expect(verifyStripeSignature(payload + " ", signed(payload, t), SECRET, t)).toBe(false);
    expect(verifyStripeSignature(payload, null, SECRET, t)).toBe(false);
    expect(verifyStripeSignature(payload, "t=abc,v1=zz", SECRET, t)).toBe(false);
    // several v1 values: any match counts
    expect(verifyStripeSignature(payload, `${signed(payload, t)},v1=deadbeef`, SECRET, t)).toBe(true);
    expect(parseStripeEvent(payload)?.type).toBe("ping");
    expect(parseStripeEvent("nope")).toBeNull();
  });

  it("finds the family in session and subscription events", () => {
    const id = "0123456789ab";
    expect(familyIdFromEvent(event("checkout.session.completed", { client_reference_id: id }))).toBe(id);
    expect(familyIdFromEvent(event("customer.subscription.updated", { metadata: { family: id } }))).toBe(id);
    expect(familyIdFromEvent(event("customer.subscription.updated", { metadata: { family: "short" } }))).toBeNull();
    expect(familyIdFromEvent(event("invoice.paid", {}))).toBeNull();
  });

  it("applies the subscription lifecycle in order and ignores replays", () => {
    const { record } = createFamily();
    const done = applyStripeEvent(record, event("checkout.session.completed", { mode: "subscription", customer: "cus_1", subscription: "sub_1", client_reference_id: record.id }, { id: "evt_a", created: 100 }));
    expect(done).toBe(true);
    expect(record.billing?.customerId).toBe("cus_1");
    expect(record.billing?.status).toBe("active");

    const sub = {
      id: "sub_1",
      customer: { id: "cus_1" },
      status: "active",
      cancel_at_period_end: false,
      metadata: { family: record.id },
      items: { data: [{ current_period_end: 1_765_000_000, price: { recurring: { interval: "year" } } }] },
    };
    expect(applyStripeEvent(record, event("customer.subscription.created", sub, { id: "evt_b", created: 101 }))).toBe(true);
    expect(record.billing?.interval).toBe("year");
    expect(record.billing?.currentPeriodEnd).toBe(new Date(1_765_000_000 * 1000).toISOString());

    // replay of the same event id: no change
    expect(applyStripeEvent(record, event("customer.subscription.created", sub, { id: "evt_b", created: 101 }))).toBe(false);
    // an older event arriving late: no change
    expect(applyStripeEvent(record, event("customer.subscription.updated", { ...sub, status: "past_due" }, { id: "evt_old", created: 50 }))).toBe(false);
    expect(record.billing?.status).toBe("active");

    expect(applyStripeEvent(record, event("customer.subscription.updated", { ...sub, status: "past_due", cancel_at_period_end: true }, { id: "evt_c", created: 102 }))).toBe(true);
    expect(record.billing?.status).toBe("past_due");
    expect(record.billing?.cancelAtPeriodEnd).toBe(true);

    expect(applyStripeEvent(record, event("customer.subscription.deleted", sub, { id: "evt_d", created: 103 }))).toBe(true);
    expect(record.billing?.status).toBe("canceled");

    // unrelated events are ignored
    expect(applyStripeEvent(record, event("invoice.paid", { customer: "cus_1" }, { id: "evt_e", created: 104 }))).toBe(false);
    expect(applyStripeEvent(record, event("checkout.session.completed", { mode: "payment", customer: "cus_1" }, { id: "evt_f", created: 105 }))).toBe(false);
  });

  it("builds a Checkout session through the REST API", async () => {
    const calls: { url: string; body: string; auth: string | null }[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init?.body), auth: (init?.headers as Record<string, string>)?.authorization ?? null });
      return new Response(JSON.stringify({ id: "cs_1", url: "https://checkout.stripe.com/c/pay/cs_1" }), { status: 200 });
    }) as typeof fetch;
    const url = await createCheckout({ familyId: "0123456789ab", interval: "year", customerId: null, successUrl: "https://x/s", cancelUrl: "https://x/c" }, fetchImpl);
    expect(url).toBe("https://checkout.stripe.com/c/pay/cs_1");
    expect(calls[0].url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(calls[0].auth).toBe("Bearer sk_test_x");
    const p = new URLSearchParams(calls[0].body);
    expect(p.get("mode")).toBe("subscription");
    expect(p.get("line_items[0][price]")).toBe("price_y");
    expect(p.get("client_reference_id")).toBe("0123456789ab");
    expect(p.get("subscription_data[metadata][family]")).toBe("0123456789ab");
    expect(p.get("customer")).toBeNull();

    const failing = (async () => new Response(JSON.stringify({ error: { message: "No such price" } }), { status: 400 })) as typeof fetch;
    await expect(createCheckout({ familyId: "0123456789ab", interval: "month", successUrl: "https://x/s", cancelUrl: "https://x/c" }, failing)).rejects.toThrow("No such price");
  });
});

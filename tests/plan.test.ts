import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { billingEnabled, billingGivesFamily, canExtract, canUse, maxChildrenFor, planLimits, planOf } from "@/lib/plan";
import type { Billing } from "@/lib/types";

const ENV = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_MONTHLY", "STRIPE_PRICE_YEARLY", "FREE_MONTHLY_NOTICES", "FREE_MAX_CHILDREN"];

function billing(over: Partial<Billing> = {}): Billing {
  return { customerId: "cus_1", subscriptionId: "sub_1", status: "active", interval: "month", currentPeriodEnd: "2026-12-06T00:00:00.000Z", cancelAtPeriodEnd: false, updatedAt: "2026-11-06T00:00:00.000Z", lastEvent: "evt_1", ...over };
}

describe("plan", () => {
  beforeEach(() => {
    for (const k of ENV) delete process.env[k];
  });
  afterEach(() => {
    for (const k of ENV) delete process.env[k];
  });

  it("is off without Stripe keys and then everyone has the Family plan", () => {
    expect(billingEnabled()).toBe(false);
    expect(planOf({ billing: null })).toBe("family");
    expect(canUse({ billing: null }, "gmail")).toBe(true);
    expect(canExtract({ billing: null, usage: { "2026-11": 999 } }, "2026-11")).toEqual({ ok: true });
    expect(maxChildrenFor({ billing: null, children: [] }, 8)).toBe(8);
  });

  it("gates the Free plan once billing is on", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_x";
    process.env.STRIPE_PRICE_MONTHLY = "price_m";
    process.env.FREE_MONTHLY_NOTICES = "2";
    process.env.FREE_MAX_CHILDREN = "1";
    expect(billingEnabled()).toBe(true);
    expect(planLimits().freeNotices).toBe(2);
    expect(planOf({ billing: null })).toBe("free");
    expect(canUse({ billing: null }, "digest")).toBe(false);
    expect(canExtract({ billing: null, usage: { "2026-11": 1 } }, "2026-11")).toEqual({ ok: true });
    expect(canExtract({ billing: null, usage: { "2026-11": 2 } }, "2026-11")).toEqual({ ok: false, reason: "plan_limit", used: 2, limit: 2 });
    expect(canExtract({ billing: null, usage: { "2026-10": 5 } }, "2026-11")).toEqual({ ok: true });
    // children: the cap, but never below what the family already has
    expect(maxChildrenFor({ billing: null, children: [] }, 8)).toBe(1);
    const three = [{ id: "a", name: "A", color: "#000000" }, { id: "b", name: "B", color: "#000000" }, { id: "c", name: "C", color: "#000000" }];
    expect(maxChildrenFor({ billing: null, children: three }, 8)).toBe(3);
  });

  it("reads the subscription status", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_x";
    process.env.STRIPE_PRICE_YEARLY = "price_y";
    expect(planOf({ billing: billing() })).toBe("family");
    expect(planOf({ billing: billing({ status: "trialing" }) })).toBe("family");
    expect(planOf({ billing: billing({ status: "canceled" }) })).toBe("free");
    expect(planOf({ billing: billing({ status: "unpaid" }) })).toBe("free");
    expect(planOf({ billing: billing({ status: "incomplete" }) })).toBe("free");
    // past_due keeps the plan for a week after the unpaid period end
    const end = "2026-11-01T00:00:00.000Z";
    expect(billingGivesFamily(billing({ status: "past_due", currentPeriodEnd: end }), new Date("2026-11-05T00:00:00Z"))).toBe(true);
    expect(billingGivesFamily(billing({ status: "past_due", currentPeriodEnd: end }), new Date("2026-11-09T00:00:00Z"))).toBe(false);
    expect(maxChildrenFor({ billing: billing(), children: [] }, 8)).toBe(8);
  });
});

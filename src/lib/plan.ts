import type { Billing, FamilyRecord, Plan, PlanLimits } from "./types";

// Plans. While billing is off (no Stripe keys) every family has the Family plan: the beta
// is free. Once billing is on, a family without an active subscription is on the Free
// plan: a monthly notice cap and a child cap, no Gmail, no forwarding address, no weekly
// summary, no invite links. The family key keeps working for everyone, always.
//
// Pure functions over the record and the environment; no I/O.

const num = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export function billingEnabled(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET && (process.env.STRIPE_PRICE_MONTHLY || process.env.STRIPE_PRICE_YEARLY));
}

export function planLimits(): PlanLimits {
  return {
    freeNotices: num("FREE_MONTHLY_NOTICES", 15),
    freeChildren: num("FREE_MAX_CHILDREN", 1),
    priceMonthly: process.env.NEXT_PUBLIC_PRICE_MONTHLY || "$4.99",
    priceYearly: process.env.NEXT_PUBLIC_PRICE_YEARLY || "$39",
  };
}

// Statuses that keep the Family plan on. past_due gets a grace period: Stripe retries the
// card for a while before it cancels, and the family should not lose its list meanwhile.
const PAID_STATUSES = new Set(["active", "trialing", "past_due"]);

export function billingGivesFamily(b: Billing | null | undefined, now: Date = new Date()): boolean {
  if (!b) return false;
  if (!PAID_STATUSES.has(b.status)) return false;
  if (b.status === "past_due" && b.currentPeriodEnd) {
    // seven days after the period that was not paid for
    return now.getTime() < Date.parse(b.currentPeriodEnd) + 7 * 86400000;
  }
  return true;
}

export function planOf(rec: Pick<FamilyRecord, "billing">, now: Date = new Date()): Plan {
  if (!billingEnabled()) return "family";
  return billingGivesFamily(rec.billing, now) ? "family" : "free";
}

export type Gated = "gmail" | "inbound" | "digest" | "invite";

export function canUse(rec: Pick<FamilyRecord, "billing">, feature: Gated, now: Date = new Date()): boolean {
  void feature; // every gated feature is Family-only today; the parameter keeps call sites readable
  return planOf(rec, now) === "family";
}

export function maxChildrenFor(rec: Pick<FamilyRecord, "billing" | "children">, hardMax: number, now: Date = new Date()): number {
  if (planOf(rec, now) === "family") return hardMax;
  // A family that had more children before billing switched on keeps them; it just cannot add more.
  return Math.min(hardMax, Math.max(planLimits().freeChildren, rec.children.length));
}

export type ExtractGate = { ok: true } | { ok: false; reason: "plan_limit"; used: number; limit: number };

// May this family extract one more notice this month? `month` is "YYYY-MM" in the family's zone.
export function canExtract(rec: Pick<FamilyRecord, "billing" | "usage">, month: string, now: Date = new Date()): ExtractGate {
  if (planOf(rec, now) === "family") return { ok: true };
  const limit = planLimits().freeNotices;
  const used = rec.usage[month] ?? 0;
  return used < limit ? { ok: true } : { ok: false, reason: "plan_limit", used, limit };
}

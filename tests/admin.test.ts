import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { adminCookie, adminEnabled, checkAdminToken, computeStats, familyRow, familySummary, hasLiveSubscription, isAbandoned, isAdminRequest, systemChecklist } from "@/lib/admin";
import { addExtraction, createFamily } from "@/lib/store";
import { mockExtraction } from "@/lib/extract";

const ctx = { language: "en", country: "US", timezone: "America/New_York", dateOrder: "MDY" as const, currency: "USD", weekStart: 0 as const, childNames: ["Mia"], todayIso: "2026-11-05" };

describe("admin", () => {
  beforeEach(() => {
    process.env.ADMIN_TOKEN = "0123456789abcdef0123456789abcdef";
  });
  afterEach(() => {
    delete process.env.ADMIN_TOKEN;
  });

  it("needs a long token and recognises its cookie", () => {
    expect(adminEnabled()).toBe(true);
    expect(checkAdminToken("0123456789abcdef0123456789abcdef")).toBe(true);
    expect(checkAdminToken("nope")).toBe(false);
    const cookie = adminCookie(true);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    const value = cookie.split(";")[0];
    expect(isAdminRequest(new Request("https://x/api/admin/stats", { headers: { cookie: value } }))).toBe(true);
    expect(isAdminRequest(new Request("https://x/api/admin/stats", { headers: { cookie: "pd_admin=" + "0".repeat(64) } }))).toBe(false);
    // an expired session is refused, and a session made without the second step's secret
    // stops working once that secret is set (the token alone cannot forge one)
    const [exp, who, sig] = value.split("=")[1].split(".");
    expect(who).toBe("owner");
    expect(isAdminRequest(new Request("https://x/", { headers: { cookie: `pd_admin=${Date.now() - 1000}.owner.${sig}` } }))).toBe(false);
    expect(Number(exp)).toBeGreaterThan(Date.now());
    process.env.ADMIN_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
    expect(isAdminRequest(new Request("https://x/", { headers: { cookie: value } }))).toBe(false);
    expect(isAdminRequest(new Request("https://x/", { headers: { cookie: adminCookie(true).split(";")[0] } }))).toBe(true);
    delete process.env.ADMIN_TOTP_SECRET;
    expect(isAdminRequest(new Request("https://x/api/admin/stats"))).toBe(false);
    process.env.ADMIN_TOKEN = "short";
    expect(adminEnabled()).toBe(false);
    expect(checkAdminToken("short")).toBe(false);
  });

  it("aggregates families without exposing their content", () => {
    const a = createFamily({ locale: "ko" }).record;
    const b = createFamily({ locale: "en" }).record;
    a.children = [{ id: "c1", name: "Mia", color: "#000000" }];
    addExtraction(a, mockExtraction(ctx), "upload", 1);
    addExtraction(b, mockExtraction(ctx), "gmail", 1);
    b.items[0].status = "done";
    b.gmail = { email: "p@example.com", refreshToken: "x", connectedAt: a.createdAt, lastScanAt: null, lastResult: null, processed: [], senders: [], paused: true };
    b.settings.digest = true;
    b.settings.digestEmail = "p@example.com";
    b.counters = { ask: 3 };
    a.counters = { ask: 1, reply: 2 };

    a.push = [{ endpoint: "https://fcm.googleapis.com/x", p256dh: "k", auth: "a", createdAt: new Date().toISOString() }];
    const s = computeStats([a, b], new Date());
    // table rows carry counts only
    const row = familyRow(a);
    expect(Object.keys(row).sort()).toEqual(["blocked", "children", "country", "createdAt", "empty", "gmail", "id", "items", "language", "monthUsage", "note", "open", "plan", "push", "rooms", "sources", "updatedAt"]);
    expect(JSON.stringify(row)).not.toContain(a.keyHash);
    // "abandoned" needs both: nothing on it and a month old
    const { record: idle } = createFamily();
    expect(isAbandoned(idle)).toBe(false);
    idle.createdAt = new Date(Date.now() - 40 * 86400000).toISOString();
    expect(isAbandoned(idle)).toBe(false); // touched recently
    idle.updatedAt = idle.createdAt;
    expect(isAbandoned(idle)).toBe(true);
    for (const touch of [
      (r: typeof idle) => (r.children = [{ id: "c", name: "x", color: "#000000" }]),
      (r: typeof idle) => (r.push = [{ endpoint: "https://fcm.googleapis.com/x", p256dh: "k", auth: "a", createdAt: "" }]),
      (r: typeof idle) => (r.usage = { "2026-10": 2 }),
      (r: typeof idle) => (r.settings = { ...r.settings, familyName: "Kim" }),
      (r: typeof idle) => (r.invites = [{ hash: "h", createdAt: "", expiresAt: new Date(Date.now() + 86400000).toISOString(), uses: 0, maxUses: 3 }]),
    ]) {
      const copy = structuredClone(idle);
      touch(copy);
      expect(isAbandoned(copy)).toBe(false);
    }
    expect(hasLiveSubscription(idle)).toBe(false);
    expect(hasLiveSubscription({ ...idle, billing: { customerId: "c", subscriptionId: "s", status: "active", interval: "month", currentPeriodEnd: null, cancelAtPeriodEnd: false, updatedAt: "", lastEvent: null } })).toBe(true);
    expect(hasLiveSubscription({ ...idle, billing: { customerId: "c", subscriptionId: "s", status: "canceled", interval: "month", currentPeriodEnd: null, cancelAtPeriodEnd: false, updatedAt: "", lastEvent: null } })).toBe(false);
    expect(systemChecklist().map((c) => c.key)).toContain("push");
    expect(s.push).toEqual({ families: 1, devices: 1 });
    expect(s.following).toBe(0);
    expect(s.families.total).toBe(2);
    expect(s.families.created7d).toBe(2);
    expect(s.families.withChildren).toBe(1);
    expect(s.children).toBe(1);
    expect(s.items.total).toBe(a.items.length + b.items.length);
    expect(s.items.done).toBe(1);
    expect(s.sources.byKind).toEqual({ upload: 1, gmail: 1 });
    expect(s.notices.thisMonth).toBe(2);
    expect(s.notices.byDay).toHaveLength(14);
    expect(s.notices.byDay[13].n).toBe(2);
    expect(s.gmail).toEqual({ connected: 1, paused: 1 });
    expect(s.digest.on).toBe(1);
    expect(s.plans.family).toBe(2); // billing off in tests
    expect(s.top.countries.map(([c]) => c).sort()).toEqual(["KR", "US"]);
    expect(s.counters).toEqual({ ask: 4, reply: 2 });

    const sum = familySummary(a);
    expect(sum.id).toBe(a.id);
    expect(sum.children).toBe(1);
    expect(JSON.stringify(sum)).not.toContain("Mia");
    expect(JSON.stringify(sum)).not.toContain(a.items[0].title);
  });
});

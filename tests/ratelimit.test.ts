import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { allowRequest, allowSignIn, clientIp, limiterMode, resetRateLimiter, sweepLimiter } from "@/lib/ratelimit";
import * as store from "@/lib/store";

// The limiter reads its caps at import time, so these tests use the defaults
// (20 per family per hour, 60 per IP per hour, 500 per day).

describe("ratelimit", () => {
  beforeEach(() => resetRateLimiter());
  afterEach(() => resetRateLimiter());

  it("caps one family without blocking another on the same network", async () => {
    for (let i = 0; i < 20; i++) expect((await allowRequest({ ip: "1.1.1.1", family: "fam-a" })).ok).toBe(true);
    const blocked = await allowRequest({ ip: "1.1.1.1", family: "fam-a" });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.reason).toBe("rate_limited");
      expect(blocked.retryAfterSec).toBeGreaterThan(0);
      expect(blocked.retryAfterSec).toBeLessThanOrEqual(3600);
    }
    expect((await allowRequest({ ip: "1.1.1.1", family: "fam-b" })).ok).toBe(true);
  });

  it("caps an address with no family", async () => {
    for (let i = 0; i < 60; i++) expect((await allowRequest({ ip: "2.2.2.2", family: null })).ok).toBe(true);
    expect((await allowRequest({ ip: "2.2.2.2", family: null })).ok).toBe(false);
    expect((await allowRequest({ ip: "3.3.3.3", family: null })).ok).toBe(true);
  });

  it("enforces the daily cap across everyone", async () => {
    let n = 0;
    for (let ip = 0; ip < 20; ip++) {
      for (let i = 0; i < 30; i++) {
        const g = await allowRequest({ ip: `10.0.0.${ip}`, family: `f${ip}-${i % 2}` });
        if (g.ok) n++;
        else if (g.reason === "daily_cap") {
          expect(n).toBe(500);
          expect(g.retryAfterSec).toBeGreaterThanOrEqual(60);
          return;
        }
      }
    }
    throw new Error("daily cap never reached");
  });

  it("keeps counting when the server instance is replaced", async () => {
    for (let i = 0; i < 20; i++) expect((await allowRequest({ ip: "4.4.4.4", family: "fam-c" })).ok).toBe(true);
    // a new instance: nothing in memory, the stored counts are still there
    resetRateLimiter({ memoryOnly: true });
    const blocked = await allowRequest({ ip: "4.4.4.4", family: "fam-c" });
    expect(blocked).toMatchObject({ ok: false, reason: "rate_limited" });
    // a refused request counts nowhere: the address is at 20 of 60, not 21
    resetRateLimiter({ memoryOnly: true });
    for (let i = 0; i < 40; i++) expect((await allowRequest({ ip: "4.4.4.4", family: null })).ok).toBe(true);
    resetRateLimiter({ memoryOnly: true });
    expect((await allowRequest({ ip: "4.4.4.4", family: null })).ok).toBe(false);
  });

  it("never lets more than the cap through when requests arrive side by side on many instances", async () => {
    const burst = (ip: string, n: number) =>
      Promise.all(
        Array.from({ length: n }, async () => {
          resetRateLimiter({ memoryOnly: true });
          return allowRequest({ ip, family: null });
        }),
      );
    // a burst within the cap goes through whole
    expect((await burst("5.5.5.5", 30)).filter((g) => g.ok)).toHaveLength(30);
    // one that would pass it is cut, and what was refused left nothing behind
    expect((await burst("5.5.5.5", 90)).filter((g) => g.ok).length).toBeLessThanOrEqual(30);
    resetRateLimiter({ memoryOnly: true });
    let more = 0;
    while ((await allowRequest({ ip: "5.5.5.5", family: null })).ok) more++;
    expect(more).toBeLessThanOrEqual(30);
    resetRateLimiter({ memoryOnly: true });
    expect((await allowRequest({ ip: "5.5.5.5", family: null })).ok).toBe(false);
  });

  it("refuses when the store cannot be reached, and holds nothing", async () => {
    const spy = vi.spyOn(store, "listMarks").mockRejectedValue(new Error("down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await allowRequest({ ip: "9.9.9.1", family: "fam-e" })).toMatchObject({ ok: false, reason: "rate_limited" });
    // an outage does not use up the address: a hundred refused requests later...
    for (let i = 0; i < 100; i++) expect((await allowRequest({ ip: "9.9.9.1", family: "fam-e" })).ok).toBe(false);
    spy.mockRestore();
    err.mockRestore();
    // ...the same instance lets the family in again as soon as the store answers
    expect((await allowRequest({ ip: "9.9.9.1", family: "fam-e" })).ok).toBe(true);
    resetRateLimiter();
    // nothing was left behind by the refused request
    for (let i = 0; i < 20; i++) expect((await allowRequest({ ip: "9.9.9.1", family: "fam-e" })).ok).toBe(true);
  });

  it("clears up after an outage: entries it could not take away then are taken away later", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    // the write lands, its answer is lost, and nothing can be removed either
    const list = vi.spyOn(store, "listMarks").mockRejectedValue(new Error("down"));
    const remove = vi.spyOn(store, "removeMark").mockRejectedValue(new Error("down"));
    for (let i = 0; i < 1200; i++) expect((await allowSignIn("9.9.9.2")).ok).toBe(false);
    list.mockRestore();
    remove.mockRestore();
    err.mockRestore();
    // the store is back: the leftovers go before anything is counted, all ten attempts are there
    for (let i = 0; i < 10; i++) expect((await allowSignIn("9.9.9.2")).ok).toBe(true);
    expect((await allowSignIn("9.9.9.2")).ok).toBe(false);
  });

  it("sweeps the buckets of hours and days that are over", async () => {
    await allowRequest({ ip: "6.6.6.6", family: "fam-d" });
    await new Promise((r) => setTimeout(r, 10)); // the clearing-up that request started
    expect(await sweepLimiter()).toBe(0);
    // Four entries: two hourly, the day's, and the note of the six-hour clearing-up
    // (which goes whenever its own period is over, so it may go at any of these steps).
    // An hour later the hourly ones stay: the bucket before the current one is kept.
    const later = await sweepLimiter(Date.now() + 3600 * 1000);
    expect(later).toBeLessThanOrEqual(1);
    const hours = await sweepLimiter(Date.now() + 2 * 3600 * 1000);
    expect(later + hours === 2 || later + hours === 3).toBe(true);
    expect(later + hours + (await sweepLimiter(Date.now() + 2 * 86400 * 1000))).toBe(4);
    expect(limiterMode()).toBe("memory");
  });

  it("reads the client address from proxy headers", () => {
    expect(clientIp(new Request("http://x", { headers: { "x-forwarded-for": "9.9.9.9, 10.0.0.1" } }))).toBe("9.9.9.9");
    expect(clientIp(new Request("http://x", { headers: { "x-real-ip": "8.8.8.8" } }))).toBe("8.8.8.8");
    expect(clientIp(new Request("http://x"))).toBe("local");
  });
});

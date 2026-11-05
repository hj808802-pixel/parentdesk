import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { allowRequest, clientIp, resetRateLimiter } from "@/lib/ratelimit";

// The limiter reads its caps at import time, so these tests use the defaults
// (20 per family per hour, 60 per IP per hour, 500 per day).

describe("ratelimit", () => {
  beforeEach(() => resetRateLimiter());
  afterEach(() => resetRateLimiter());

  it("caps one family without blocking another on the same network", () => {
    for (let i = 0; i < 20; i++) expect(allowRequest({ ip: "1.1.1.1", family: "fam-a" }).ok).toBe(true);
    const blocked = allowRequest({ ip: "1.1.1.1", family: "fam-a" });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.reason).toBe("rate_limited");
      expect(blocked.retryAfterSec).toBeGreaterThan(0);
      expect(blocked.retryAfterSec).toBeLessThanOrEqual(3600);
    }
    expect(allowRequest({ ip: "1.1.1.1", family: "fam-b" }).ok).toBe(true);
  });

  it("caps an address with no family", () => {
    for (let i = 0; i < 60; i++) expect(allowRequest({ ip: "2.2.2.2", family: null }).ok).toBe(true);
    expect(allowRequest({ ip: "2.2.2.2", family: null }).ok).toBe(false);
    expect(allowRequest({ ip: "3.3.3.3", family: null }).ok).toBe(true);
  });

  it("enforces the daily cap across everyone", () => {
    let n = 0;
    for (let ip = 0; ip < 20; ip++) {
      for (let i = 0; i < 30; i++) {
        const g = allowRequest({ ip: `10.0.0.${ip}`, family: `f${ip}-${i % 2}` });
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

  it("reads the client address from proxy headers", () => {
    expect(clientIp(new Request("http://x", { headers: { "x-forwarded-for": "9.9.9.9, 10.0.0.1" } }))).toBe("9.9.9.9");
    expect(clientIp(new Request("http://x", { headers: { "x-real-ip": "8.8.8.8" } }))).toBe("8.8.8.8");
    expect(clientIp(new Request("http://x"))).toBe("local");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { allowSignIn, allowSignup, resetRateLimiter, returnCodeGuess, takeCodeGuess } from "@/lib/ratelimit";

describe("sign-up, sign-in and class-code guards", () => {
  beforeEach(() => resetRateLimiter());

  it("caps new families per address without touching other addresses", async () => {
    for (let i = 0; i < 40; i++) expect((await allowSignup("1.1.1.1")).ok).toBe(true);
    expect(await allowSignup("1.1.1.1")).toMatchObject({ ok: false, reason: "rate_limited" });
    expect((await allowSignup("2.2.2.2")).ok).toBe(true);
    // a new server instance does not hand out a new budget
    resetRateLimiter({ memoryOnly: true });
    expect((await allowSignup("1.1.1.1")).ok).toBe(false);
  });

  it("keeps the ten sign-in attempts an hour across server instances", async () => {
    for (let i = 0; i < 10; i++) {
      resetRateLimiter({ memoryOnly: true });
      expect((await allowSignIn("7.7.7.7")).ok).toBe(true);
    }
    resetRateLimiter({ memoryOnly: true });
    expect((await allowSignIn("7.7.7.7")).ok).toBe(false);
    expect((await allowSignIn("8.8.8.8")).ok).toBe(true);
  });

  it("does not lock an address out because a burst was refused", async () => {
    // eleven at once on one instance: the store sees more than ten and refuses them all
    vi.useFakeTimers({ toFake: ["Date"] });
    const all = await Promise.all(Array.from({ length: 11 }, () => allowSignIn("6.6.6.6")));
    expect(all.filter((g) => g.ok).length).toBeLessThanOrEqual(10);
    // nothing was let through, so nothing is used up: a moment later the address signs in
    vi.setSystemTime(Date.now() + 20 * 1000);
    const left = 10 - all.filter((g) => g.ok).length;
    for (let i = 0; i < left; i++) expect((await allowSignIn("6.6.6.6")).ok).toBe(true);
    expect((await allowSignIn("6.6.6.6")).ok).toBe(false);
    vi.useRealTimers();
  });

  it("stops taking class-code guesses for a room after twenty wrong ones", async () => {
    const room = "a".repeat(12);
    // right codes hand their guess back: a whole class can join
    for (let i = 0; i < 50; i++) {
      const g = await takeCodeGuess(room);
      if (!g) throw new Error("no guess left");
      await returnCodeGuess(g);
    }
    for (let i = 0; i < 20; i++) expect(await takeCodeGuess(room)).not.toBeNull();
    expect(await takeCodeGuess(room)).toBeNull();
    resetRateLimiter({ memoryOnly: true });
    expect(await takeCodeGuess(room)).toBeNull();
    expect(await takeCodeGuess("b".repeat(12))).not.toBeNull();
  });

  it("takes at most twenty guesses sent side by side to many instances", async () => {
    const room = "c".repeat(12);
    const all = await Promise.all(
      Array.from({ length: 60 }, async () => {
        resetRateLimiter({ memoryOnly: true });
        return takeCodeGuess(room);
      }),
    );
    expect(all.filter(Boolean).length).toBeLessThanOrEqual(20);
    // and the room never takes more than twenty in the hour, whatever the order
    let more = all.filter(Boolean).length;
    for (;;) {
      resetRateLimiter({ memoryOnly: true });
      if (!(await takeCodeGuess(room))) break;
      more++;
    }
    expect(more).toBe(20);
  });
});

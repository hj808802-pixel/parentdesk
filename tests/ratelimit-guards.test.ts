import { beforeEach, describe, expect, it } from "vitest";
import { allowSignup, resetRateLimiter, returnCodeGuess, takeCodeGuess } from "@/lib/ratelimit";

describe("sign-up and class-code guards", () => {
  beforeEach(() => resetRateLimiter());

  it("caps new families per address without touching other addresses", () => {
    for (let i = 0; i < 40; i++) expect(allowSignup("1.1.1.1").ok).toBe(true);
    expect(allowSignup("1.1.1.1")).toMatchObject({ ok: false, reason: "rate_limited" });
    expect(allowSignup("2.2.2.2").ok).toBe(true);
  });

  it("stops taking class-code guesses for a room after twenty wrong ones", () => {
    const room = "a".repeat(12);
    // right codes hand their guess back: a whole class can join
    for (let i = 0; i < 50; i++) {
      expect(takeCodeGuess(room)).toBe(true);
      returnCodeGuess(room);
    }
    for (let i = 0; i < 20; i++) expect(takeCodeGuess(room)).toBe(true);
    expect(takeCodeGuess(room)).toBe(false);
    expect(takeCodeGuess("b".repeat(12))).toBe(true);
  });
});

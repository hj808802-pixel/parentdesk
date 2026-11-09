import { describe, expect, it } from "vitest";
import { summarize } from "@/lib/dashboard";
import { addDays, todayIn } from "@/lib/dates";
import { mockExtraction } from "@/lib/extract";
import { addExtraction, createFamily, sanitizeChildren } from "@/lib/store";

describe("dashboard summary", () => {
  it("counts what the home screen shows", () => {
    const { record } = createFamily({ locale: "en" });
    record.children = sanitizeChildren([{ name: "Mia" }], []);
    const today = todayIn("UTC");
    const ctx = { language: "en", country: "US", timezone: "UTC", dateOrder: "MDY" as const, currency: "USD", weekStart: 0 as const, childNames: ["Mia"], todayIso: today };
    addExtraction(record, mockExtraction(ctx), "upload", 1);
    const s = summarize(record.items, record.sources, today, 0);
    expect(s.toSign).toBe(1);
    expect(s.toPay).toEqual({ count: 1, totals: { USD: 12 } });
    expect(s.needsAction).toBeGreaterThanOrEqual(3);
    expect(s.overdue).toBe(0);
    expect(s.next.length).toBe(3);
    for (let i = 1; i < s.next.length; i++) expect(s.next[i - 1].date! <= s.next[i].date!).toBe(true);
    expect(s.recent.length).toBe(1);
    expect(s.roomNews).toEqual({});
  });

  it("notices past-due items, done items and room news", () => {
    const { record } = createFamily();
    const today = todayIn("UTC");
    const ctx = { language: "en", country: "US", timezone: "UTC", dateOrder: "MDY" as const, currency: "USD", weekStart: 1 as const, childNames: [], todayIso: today };
    addExtraction(record, mockExtraction(ctx), "upload", 1);
    record.items[0].date = addDays(today, -3); // the trip was yesterday-ish
    record.items[1].status = "done"; // the slip is signed
    record.sources[0].roomId = "r1";
    record.sources.push({ ...record.sources[0], id: "old", roomId: "r1", ts: new Date(Date.now() - 10 * 86400000).toISOString() });
    const s = summarize(record.items, record.sources, today, 1);
    expect(s.overdue).toBe(1);
    expect(s.toSign).toBe(0);
    expect(s.roomNews).toEqual({ r1: 1 });
    expect(s.recent[0].id).toBe(record.sources[0].id);
    expect(s.next.every((it) => it.date! >= today && it.status === "open")).toBe(true);
  });
});

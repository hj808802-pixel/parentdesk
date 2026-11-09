import { describe, expect, it } from "vitest";
import { bringList, findClashes, summarize, weekBrief } from "@/lib/dashboard";
import { fmt } from "@/lib/i18n";
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

  it("lists what to pack today and tomorrow, writes a brief, and spots two children at one time", () => {
    const { record } = createFamily();
    record.children = sanitizeChildren([{ name: "Mia" }, { name: "Leo" }], []);
    const today = todayIn("UTC");
    const tomorrow = addDays(today, 1);
    const ctx = { language: "en", country: "US", timezone: "UTC", dateOrder: "MDY" as const, currency: "USD", weekStart: 0 as const, childNames: ["Mia"], todayIso: today };
    addExtraction(record, mockExtraction(ctx), "upload", 1);
    const trip = record.items.find((i) => i.title.includes("field trip") && i.type === "event")!;
    trip.date = tomorrow;
    trip.time = "08:30";
    const library = record.items.find((i) => i.title.startsWith("Return library"))!;
    library.date = today;
    const packing = bringList(record.items, today);
    const titles = packing.map((p) => p.item.title);
    expect(titles).toContain("Return library books (every Monday)");
    expect(titles).toContain("Science Museum field trip");
    expect(packing.find((p) => p.item.title === "Science Museum field trip")!.dayOffset).toBe(1);
    expect(packing.every((p) => (p.dayOffset === 0 ? p.item.date === today : p.item.date === tomorrow))).toBe(true);
    const labels = { overdue: "{n} past due.", due: "Due by {date}: {list}.", events: "Coming up: {list}.", quiet: "Nothing due this week.", more: "and {n} more" };
    const brief = weekBrief(record.items, today, "en", labels, fmt);
    expect(brief.length).toBeGreaterThanOrEqual(1);
    expect(brief.join(" ")).toContain("Coming up:");
    expect(weekBrief([], today, "en", labels, fmt)).toEqual(["Nothing due this week."]);
    // a second child's event at the same hour as the trip
    const recital = { ...trip, id: "x1", title: "Leo's recital", childIds: [record.children[1].id], time: "09:00", end_time: "10:00" };
    const later = { ...trip, id: "x2", title: "Later", childIds: [record.children[1].id], time: "11:00", end_time: null };
    const shared = { ...trip, id: "x3", title: "Both", childIds: [record.children[0].id, record.children[1].id], time: "08:45", end_time: null };
    const clashes = findClashes([...record.items, recital, later, shared]);
    // 08:30-09:30 overlaps 09:00-10:00 for different children; "Later" at 11:00 is clear;
    // "Both" shares a child with the trip and with the recital, so it never clashes.
    expect(clashes.map((c) => [c.a.title, c.b.title])).toEqual([["Science Museum field trip", "Leo's recital"]]);
    expect(findClashes(record.items)).toEqual([]);
  });
});

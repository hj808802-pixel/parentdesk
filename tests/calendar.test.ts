import { describe, expect, it } from "vitest";
import { daysInMonth, itemsByDay, monthGrid, shiftMonth } from "@/lib/calendar";
import { mockExtraction } from "@/lib/extract";
import { addExtraction, createFamily } from "@/lib/store";

const ctx = { language: "en", country: "US", timezone: "UTC", dateOrder: "MDY" as const, currency: "USD", weekStart: 0 as const, childNames: [], todayIso: "2026-11-05" };

describe("calendar", () => {
  it("moves between months and knows their length", () => {
    expect(shiftMonth("2026-11", 1)).toBe("2026-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(daysInMonth("2026-02")).toBe(28);
    expect(daysInMonth("2028-02")).toBe(29);
    expect(daysInMonth("2026-11")).toBe(30);
  });

  it("lays the month out in whole weeks from the chosen first weekday", () => {
    const monday = monthGrid("2026-11", 1); // 1 Nov 2026 is a Sunday
    expect(monday.length % 7).toBe(0);
    expect(monday[0].iso).toBe("2026-10-26");
    expect(monday[0].inMonth).toBe(false);
    expect(monday.find((c) => c.iso === "2026-11-01")?.inMonth).toBe(true);
    expect(monday[monday.length - 1].iso).toBe("2026-12-06");
    const sunday = monthGrid("2026-11", 0);
    expect(sunday[0].iso).toBe("2026-11-01");
    expect(sunday.length).toBe(35);
  });

  it("puts items on their days, spreads multi-day events and leaves dismissed ones out", () => {
    const { record } = createFamily();
    const { items } = addExtraction(record, mockExtraction(ctx), "upload", 1);
    const noSchool = items.find((i) => i.title.startsWith("No school"))!;
    const slip = items.find((i) => i.type === "consent")!;
    slip.status = "dismissed";
    const byDay = itemsByDay(record.items);
    expect(byDay.get(noSchool.date!)?.some((i) => i.id === noSchool.id)).toBe(true);
    expect(byDay.get(noSchool.end_date!)?.some((i) => i.id === noSchool.id)).toBe(true); // the second day off
    expect([...byDay.values()].flat().some((i) => i.id === slip.id)).toBe(false);
    const trip = items.find((i) => i.title.includes("field trip") && i.type === "event")!;
    const payment = items.find((i) => i.type === "payment")!;
    expect(byDay.get(trip.date!)?.map((i) => i.id)).toContain(trip.id);
    expect(byDay.get(payment.date!)?.map((i) => i.id)).toContain(payment.id);
  });
});

import { describe, expect, it } from "vitest";
import { bringAhead, staleOpen } from "@/lib/dashboard";
import { addDays, todayIn } from "@/lib/dates";
import { mockExtraction } from "@/lib/extract";
import { ExtractionSchema } from "@/lib/schema";
import { addExtraction, applyItemPatch, createFamily, nextOccurrence, sanitizeSettings } from "@/lib/store";

const today = todayIn("UTC");
const ctx = { language: "en", country: "US", timezone: "UTC", dateOrder: "MDY" as const, currency: "USD", weekStart: 0 as const, childNames: [], todayIso: today };

describe("parent helpers", () => {
  it("carries the stated rhythm of repeating items and rolls them forward when ticked off", () => {
    const ex = mockExtraction(ctx);
    expect(ExtractionSchema.safeParse(ex).success).toBe(true);
    expect(ex.items.filter((i) => i.recurrence === "weekly").map((i) => i.title)).toEqual(["Return library books (every Monday)", "PE days: Tuesdays and Thursdays"]);
    const { record } = createFamily();
    const { items } = addExtraction(record, ex, "upload", 1);
    const books = items.find((i) => i.title.startsWith("Return library"))!;
    expect(books.recurrence).toBe("weekly");
    expect(items.find((i) => i.type === "payment")!.recurrence).toBeUndefined();
    const next = nextOccurrence(books, "2026-11-10T00:00:00.000Z")!;
    expect(next.date).toBe(addDays(books.date!, 7));
    expect(next.id).not.toBe(books.id);
    expect(next.status).toBe("open");
    expect(next.sourceId).toBe(books.sourceId);
    expect(nextOccurrence({ ...books, recurrence: "monthly", date: "2026-01-31" })!.date).toBe("2026-03-03"); // JS month arithmetic, as documented
    expect(nextOccurrence({ ...books, recurrence: "biweekly", date: "2026-11-02", end_date: "2026-11-03" })).toMatchObject({ date: "2026-11-16", end_date: "2026-11-17" });
    expect(nextOccurrence({ ...books, recurrence: undefined })).toBeNull();
    expect(nextOccurrence({ ...books, date: null })).toBeNull();
    const roomCopy = nextOccurrence({ ...books, roomItemIndex: 3 })!;
    expect(roomCopy.roomItemIndex).toBeUndefined(); // the next occurrence is the family's own
  });

  it("assigns an owner and a rhythm through patches, and keeps the family members tidy", () => {
    const { record } = createFamily();
    const { items } = addExtraction(record, mockExtraction(ctx), "upload", 1);
    const it0 = items[0];
    expect(applyItemPatch(it0, { owner: "  Mom " }).owner).toBe("Mom");
    expect(applyItemPatch({ ...it0, owner: "Mom" }, { owner: null }).owner).toBeUndefined();
    expect(applyItemPatch(it0, { owner: "" }).owner).toBeUndefined();
    expect(applyItemPatch(it0, { recurrence: "monthly" }).recurrence).toBe("monthly");
    expect(applyItemPatch(it0, { recurrence: "yearly" }).recurrence).toBeUndefined();
    expect(applyItemPatch({ ...it0, recurrence: "weekly" }, { recurrence: null }).recurrence).toBeUndefined();
    const s = sanitizeSettings({ members: [" Mom ", "Dad", "", "Mom", 7, "x".repeat(40), "a", "b", "c", "d", "e"] }, record.settings);
    expect(s.members).toEqual(["Mom", "Dad", "x".repeat(20), "a", "b", "c"]);
    expect(sanitizeSettings({}, { ...record.settings, members: undefined as unknown as string[] }).members).toEqual([]);
  });

  it("lists what to pack later in the fortnight and what is stale", () => {
    const { record } = createFamily();
    const { items } = addExtraction(record, mockExtraction(ctx), "upload", 1);
    const trip = items.find((i) => i.title.includes("field trip") && i.type === "event")!;
    trip.date = addDays(today, 5);
    const books = items.find((i) => i.title.startsWith("Return library"))!;
    books.date = addDays(today, 1); // tomorrow: on the packing list, not in the look-ahead
    const old = items.find((i) => i.type === "payment")!;
    old.date = addDays(today, -10);
    const recent = items.find((i) => i.type === "consent")!;
    recent.date = addDays(today, -2);
    const ahead = bringAhead(record.items, today);
    expect(ahead.map((i) => i.title)).toContain("Science Museum field trip");
    expect(ahead.some((i) => i.title.startsWith("Return library"))).toBe(false);
    expect(ahead.every((i) => i.date! > addDays(today, 1) && i.date! <= addDays(today, 14))).toBe(true);
    expect(staleOpen(record.items, today).map((i) => i.id)).toEqual([old.id]); // 2 days past is within the grace period
    old.status = "done";
    expect(staleOpen(record.items, today)).toEqual([]);
  });
});

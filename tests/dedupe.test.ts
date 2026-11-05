import { describe, expect, it } from "vitest";
import { findDuplicate, isDuplicate, normalizeTitle, titleSimilarity } from "@/lib/dedupe";
import { addExtraction, createFamily } from "@/lib/store";
import { mockExtraction } from "@/lib/extract";

const ctx = { language: "en", country: "US", timezone: "America/New_York", dateOrder: "MDY" as const, currency: "USD", weekStart: 0 as const, childNames: ["Mia"], todayIso: "2026-11-05" };

const base = { type: "event" as const, amount: null, quote: null };

describe("dedupe", () => {
  it("normalises and compares titles in Latin and CJK scripts", () => {
    expect(normalizeTitle("  Pay Trip Fee, $12!  ")).toBe("pay trip fee 12");
    expect(titleSimilarity("Science Museum field trip", "Field trip to the Science Museum")).toBeGreaterThanOrEqual(0.5);
    expect(titleSimilarity("Pay the trip fee", "Sign the trip slip")).toBeLessThan(0.5);
    expect(titleSimilarity("현장체험학습 참가비 15,000원 납부", "현장체험학습 참가비 납부")).toBeGreaterThanOrEqual(0.5);
    expect(titleSimilarity("현장체험학습 참가비 납부", "현장체험학습 동의서 제출")).toBeLessThan(0.5);
    expect(titleSimilarity("遠足のお弁当", "運動会の準備")).toBeLessThan(0.5);
  });

  it("needs the same date and a matching title, amount or quote", () => {
    const trip = { ...base, title: "Science Museum field trip", date: "2026-11-13" };
    expect(isDuplicate({ ...base, title: "Field trip to the Science Museum", date: "2026-11-13" }, trip)).toBe(true);
    expect(isDuplicate({ ...base, title: "Field trip to the Science Museum", date: "2026-11-20" }, trip)).toBe(false);
    expect(isDuplicate({ ...base, title: "Picture day", date: "2026-11-13" }, trip)).toBe(false);
    // same payment, different wording
    const fee = { ...base, type: "payment" as const, title: "Pay 12 USD trip fee", date: "2026-11-11", amount: 12 };
    expect(isDuplicate({ ...base, type: "payment" as const, title: "Museum money", date: "2026-11-11", amount: 12 }, fee)).toBe(true);
    // the slip and the fee share a quote and a date but are different things
    const slip = { ...base, type: "consent" as const, title: "Sign the permission slip", date: "2026-11-11", quote: "Permission slip and $12 due by Wednesday" };
    expect(isDuplicate({ ...fee, quote: "Permission slip and $12 due by Wednesday" }, slip)).toBe(false);
    // undated items can still match
    expect(isDuplicate({ ...base, type: "todo" as const, title: "Return library books", date: null }, { ...base, type: "todo" as const, title: "Library books to return", date: null })).toBe(true);
  });

  it("skips items the family already has when an extraction is added again", () => {
    const { record } = createFamily();
    const first = addExtraction(record, mockExtraction(ctx), "upload", 1);
    expect(first.items.length).toBe(9);
    expect(first.skipped).toBe(0);
    const again = addExtraction(record, mockExtraction(ctx), "share", 1);
    expect(again.items.length).toBe(0);
    expect(again.skipped).toBe(9);
    expect(record.sources.length).toBe(1);
    expect(record.items.length).toBe(9);
    expect(record.usage[new Date().toISOString().slice(0, 7)]).toBe(1);
    expect(findDuplicate({ ...base, title: "Picture day", date: first.items.find((i) => i.title === "Picture day")!.date }, record.items)).not.toBeNull();
  });
});

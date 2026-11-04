import { describe, expect, it } from "vitest";
import { contextLines, loadPack, mockExtraction } from "@/lib/extract";
import { ExtractionSchema } from "@/lib/schema";
import { htmlToText } from "@/app/api/inbound/route";

const ctx = { language: "ja", country: "JP", timezone: "Asia/Tokyo", dateOrder: "YMD" as const, currency: "JPY", weekStart: 0 as const, childNames: ["Hana", "Ren"], todayIso: "2026-11-05", hintChildName: "Ren" };

describe("extract", () => {
  it("mock extraction matches the schema and places dates after today", () => {
    const ex = mockExtraction(ctx);
    expect(ExtractionSchema.safeParse(ex).success).toBe(true);
    for (const it of ex.items) if (it.date) expect(it.date >= ctx.todayIso).toBe(true);
    const trip = ex.items.find((i) => i.type === "event" && i.title.includes("field trip"))!;
    const slip = ex.items.find((i) => i.type === "consent")!;
    expect(slip.date! < trip.date!).toBe(true);
    expect(ex.items.filter((i) => i.type === "payment").length).toBe(1);
  });

  it("writes the family context for the model", () => {
    const text = contextLines(ctx);
    expect(text).toContain("Japanese");
    expect(text).toContain("Japan (JP)");
    expect(text).toContain("YMD");
    expect(text).toContain('"Hana", "Ren"');
    expect(text).toContain('mainly about "Ren"');
    expect(text).toContain("2026-11-05 (Thursday)");
  });

  it("loads country packs from disk", () => {
    const jp = loadPack("JP");
    expect(jp.generic.length).toBeGreaterThan(100);
    expect(jp.country).toContain("令和");
    const other = loadPack("XX");
    expect(other.country).toBeNull();
    expect(loadPack("AT").country).toContain("Elternbrief");
  });

  it("turns e-mail html into readable text", () => {
    const text = htmlToText("<html><style>p{}</style><body><p>Trip on <b>Friday</b>.</p><br><div>Bring &amp; pack lunch</div></body></html>");
    expect(text).toBe("Trip on Friday.\n\nBring & pack lunch");
  });
});

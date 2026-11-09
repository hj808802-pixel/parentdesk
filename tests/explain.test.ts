import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { explainItem } from "@/lib/assist";
import { mockExtraction } from "@/lib/extract";
import { ExplainSchema } from "@/lib/schema";
import { addExtraction, createFamily } from "@/lib/store";

const ctx = { language: "ko", country: "KR", timezone: "Asia/Seoul", dateOrder: "YMD" as const, currency: "KRW", weekStart: 1 as const, childNames: [], todayIso: "2026-11-05" };

describe("explain (demo mode)", () => {
  let savedKey: string | undefined;
  beforeEach(() => {
    savedKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    process.env.MOCK_EXTRACT = "1";
  });
  afterEach(() => {
    if (savedKey) process.env.ANTHROPIC_API_KEY = savedKey;
    delete process.env.MOCK_EXTRACT;
  });

  it("explains an item with steps and a question when the date is not certain", async () => {
    const { record } = createFamily({ locale: "ko" });
    const { source, items } = addExtraction(record, mockExtraction(ctx), "upload", 1);
    const slip = items.find((i) => i.type === "consent")!;
    const out = await explainItem(record, slip, source, "2026-11-05");
    expect(out.mock).toBe(true);
    expect(ExplainSchema.safeParse(out.result).success).toBe(true);
    expect(out.result.explanation).toContain(slip.title);
    expect(out.result.what_to_do.length).toBeGreaterThan(0);
    expect(out.result.ask_school).toBeNull(); // the slip's date is stated plainly
    const guess = items.find((i) => i.confidence === "medium")!;
    expect((await explainItem(record, guess, source, "2026-11-05")).result.ask_school).not.toBeNull();
  });
});

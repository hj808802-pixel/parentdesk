import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { askAssistant, classifyEmails, draftReply, familyBrief, itemLine, languageName } from "@/lib/assist";
import { mockExtraction } from "@/lib/extract";
import { addExtraction, createFamily, sanitizeChildren } from "@/lib/store";

const ctx = { language: "ko", country: "KR", timezone: "Asia/Seoul", dateOrder: "YMD" as const, currency: "KRW", weekStart: 1 as const, childNames: ["Mia"], todayIso: "2026-11-05" };

describe("assist (demo mode)", () => {
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

  it("writes a compact brief of the family for the model", () => {
    const { record } = createFamily({ locale: "ko" });
    record.children = sanitizeChildren([{ name: "Mia" }], []);
    addExtraction(record, mockExtraction(ctx), "upload", 1);
    record.items[0].status = "done";
    const brief = familyBrief(record, "2026-11-05");
    expect(brief).toContain("Country KR, language Korean");
    expect(brief).toContain("Children: Mia.");
    expect(brief).toContain("Today: 2026-11-05 (Thursday).");
    expect(brief).toContain("Open items (8):");
    expect(brief).toContain("Recently done or dismissed:");
    expect(brief).toContain("Notices:");
    const line = itemLine(record.items[2], new Map([[record.children[0].id, "Mia"]]));
    expect(line).toContain(`id=${record.items[2].id}`);
    expect(line).toContain("[payment]");
    expect(line).toContain("12 USD");
    expect(line).toContain("child: Mia");
    expect(languageName("ja")).toContain("Japanese");
    expect(languageName("zh-TW")).toContain("Traditional");
    expect(languageName("xx")).toBe("xx");
  });

  it("answers, drafts and classifies without a key", async () => {
    const { record } = createFamily();
    addExtraction(record, mockExtraction(ctx), "upload", 1);
    const ask = await askAssistant(record, "What is next?", "2026-11-05");
    expect(ask.mock).toBe(true);
    expect(ask.result.item_ids.length).toBeGreaterThan(0);
    expect(ask.result.answer).toContain("demo");

    const reply = await draftReply(record, record.items[1], record.sources[0], "yes", "", "2026-11-05");
    expect(reply.mock).toBe(true);
    expect(reply.result.reply).toContain(record.items[1].title);

    const picked = await classifyEmails(
      [
        { from: "a@shop.example", subject: "Sale", snippet: "" },
        { from: "office@school.example", subject: "PTA meeting", snippet: "" },
      ],
      (h) => /school|pta/i.test(`${h.from} ${h.subject}`),
    );
    expect(picked.picked).toEqual([1]);
  });
});

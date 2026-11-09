import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { composeNotice, helpParentMessage } from "@/lib/assist";
import { mockExtraction } from "@/lib/extract";
import { applyTally, createRoom, createTeacher, deliverPost, makePost, subscribe } from "@/lib/rooms";
import { ComposeSchema, ParentMessageSchema } from "@/lib/schema";
import { createFamily } from "@/lib/store";

const ctx = { language: "en", country: "US", timezone: "America/New_York", dateOrder: "MDY" as const, currency: "USD", weekStart: 0 as const, childNames: [], todayIso: "2026-11-05" };

describe("teacher helpers (demo mode)", () => {
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

  it("writes a notice from facts and flags what is missing", async () => {
    const { record: teacher } = createTeacher({ name: "Ms. Rivera", school: "Oak Street Elementary", locale: "en" });
    const out = await composeNotice(teacher, "Room 12", { kind: "trip", facts: "Science museum, bus leaves 9:00, pack lunch", tone: "formal" }, "2026-11-05");
    expect(out.mock).toBe(true);
    expect(ComposeSchema.safeParse(out.result).success).toBe(true);
    expect(out.result.notice).toContain("Science museum");
    expect(out.result.notice).toContain("Oak Street Elementary · Room 12 · Ms. Rivera");
    const vague = await composeNotice(teacher, "Room 12", { kind: "event", facts: "picture day soon, wear uniform", tone: "friendly" }, "2026-11-05");
    expect(vague.result.missing).toEqual(["date"]);
  });

  it("understands a parent's message and suggests a reply", async () => {
    const { record: teacher } = createTeacher({ name: "T", locale: "ko" });
    const out = await helpParentMessage(teacher, "Hola, mi hijo no puede ir a la excursión.", "2026-11-05");
    expect(out.mock).toBe(true);
    expect(ParentMessageSchema.safeParse(out.result).success).toBe(true);
    expect(out.result.translation).toContain("excursión");
    expect(out.result.reply).toContain("T");
  });

  it("counts families that tick a delivered item off, without names", () => {
    const { record: teacher } = createTeacher({ name: "T" });
    const room = createRoom(teacher, "R")!;
    const { record: fam } = createFamily();
    subscribe(fam, room, teacher, []);
    const post = makePost(room, teacher, mockExtraction(ctx), 1);
    const res = deliverPost(fam, room, post, teacher)!;
    expect(res.items.map((it) => it.roomItemIndex)).toEqual(res.items.map((_, i) => i)); // each item knows its line
    applyTally(post, 2, "open", "done");
    applyTally(post, 2, "open", "done");
    applyTally(post, 2, "done", "dismissed");
    applyTally(post, 0, "open", "dismissed");
    applyTally(post, 0, "dismissed", "open");
    applyTally(post, 99, "open", "done"); // out of range: ignored
    applyTally(post, 1, "open", "open"); // no change: ignored
    expect(post.tally).toEqual({ "2": { done: 1, dismissed: 1 }, "0": { done: 0, dismissed: 0 } });
    expect(JSON.stringify(post)).not.toContain(fam.id);
  });
});

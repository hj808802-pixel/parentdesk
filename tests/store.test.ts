import { beforeEach, describe, expect, it } from "vitest";
import {
  addExtraction,
  applyItemPatch,
  createFamily,
  deleteFamily,
  loadFamily,
  parseFamilyCookie,
  parseFamilyKey,
  parseFeedToken,
  parseInboundAddress,
  resetMemoryStore,
  sanitizeChildren,
  sanitizeSettings,
  saveFamily,
  toView,
  verifyFeedSecret,
  verifySecret,
} from "@/lib/store";
import { mockExtraction } from "@/lib/extract";

const ctx = { language: "en", country: "US", timezone: "America/New_York", dateOrder: "MDY" as const, currency: "USD", weekStart: 0 as const, childNames: ["Mia"], todayIso: "2026-11-05" };

describe("store", () => {
  beforeEach(() => {
    delete process.env.LOCAL_DATA_DIR;
    delete process.env.BLOB_READ_WRITE_TOKEN;
    resetMemoryStore();
  });

  it("creates a family with a verifiable key and guessed defaults", async () => {
    const { record, key } = createFamily({ locale: "ko" });
    const parsed = parseFamilyKey(key)!;
    expect(parsed.id).toBe(record.id);
    expect(verifySecret(record, parsed.secret)).toBe(true);
    expect(verifySecret(record, "0".repeat(24))).toBe(false);
    expect(record.settings.country).toBe("KR");
    expect(record.settings.dateOrder).toBe("YMD");
    expect(record.settings.currency).toBe("KRW");
    expect(record.settings.language).toBe("ko");
    await saveFamily(record);
    const loaded = await loadFamily(record.id);
    expect(loaded?.id).toBe(record.id);
    await deleteFamily(record.id);
    expect(await loadFamily(record.id)).toBeNull();
  });

  it("parses keys, cookies, feed tokens and inbound addresses strictly", () => {
    expect(parseFamilyKey("pd_0123456789ab_" + "f".repeat(24))).toEqual({ id: "0123456789ab", secret: "f".repeat(24) });
    expect(parseFamilyKey("pd_short_key")).toBeNull();
    expect(parseFamilyCookie("pd_locale=en; pd_family=pd_0123456789ab_" + "a".repeat(24))?.id).toBe("0123456789ab");
    expect(parseFeedToken("0123456789ab_" + "b".repeat(16) + ".ics")).toEqual({ id: "0123456789ab", secret: "b".repeat(16) });
    expect(parseFeedToken("nope")).toBeNull();
    expect(parseInboundAddress("Smith family <0123456789AB-deadbeef@in.example.com>")).toEqual({ id: "0123456789ab", code: "deadbeef" });
    expect(parseInboundAddress("hello@in.example.com")).toBeNull();
  });

  it("hides secrets in the view and verifies the feed secret", () => {
    const { record } = createFamily();
    const view = toView(record) as unknown as Record<string, unknown>;
    expect(view.keyHash).toBeUndefined();
    expect(view.feedSecret).toBeUndefined();
    expect(view.inboundCode).toBeUndefined();
    expect(String(view.feedToken)).toMatch(/^[0-9a-f]{12}_[0-9a-f]{16}$/);
    expect(view.inboundAddress).toBeNull();
    expect(verifyFeedSecret(record, record.feedSecret)).toBe(true);
    expect(verifyFeedSecret(record, "x")).toBe(false);
  });

  it("sanitizes settings and children", () => {
    const { record } = createFamily();
    const s = sanitizeSettings({ country: "GB", language: "fr", weekStart: 5, currency: "eur", familyName: " Smith " }, record.settings);
    expect(s.country).toBe("GB");
    expect(s.dateOrder).toBe("DMY");
    expect(s.currency).toBe("GBP"); // lowercase code rejected, country default kept
    expect(s.weekStart).toBe(1);
    expect(s.language).toBe("fr");
    expect(s.familyName).toBe("Smith");
    const kids = sanitizeChildren([{ name: " Mia " }, { name: "" }, { name: "Leo", color: "#123456" }, 7], []);
    expect(kids.map((k) => k.name)).toEqual(["Mia", "Leo"]);
    expect(kids[1].color).toBe("#123456");
    expect(kids[0].id).not.toBe(kids[1].id);
  });

  it("adds an extraction, matching children by name and counting usage", () => {
    const { record } = createFamily();
    record.children = sanitizeChildren([{ name: "Mia" }, { name: "Leo" }], []);
    const { source, items } = addExtraction(record, mockExtraction(ctx), "sample", 1);
    expect(source.kind).toBe("sample");
    expect(items.length).toBe(9);
    const trip = items.find((i) => i.title === "Science Museum field trip")!;
    expect(trip.childIds).toEqual([record.children[0].id]);
    expect(trip.time).toBe("08:30");
    expect(trip.all_day).toBe(false);
    const noSchool = items.find((i) => i.title.startsWith("No school"))!;
    expect(noSchool.childIds).toEqual([]);
    expect(noSchool.end_date).not.toBeNull();
    expect(record.usage[new Date().toISOString().slice(0, 7)]).toBe(1);
    expect(record.items.length).toBe(9);
  });

  it("uses the hint child when the notice names nobody", () => {
    const { record } = createFamily();
    record.children = sanitizeChildren([{ name: "Mia" }, { name: "Leo" }], []);
    const ex = mockExtraction({ ...ctx, childNames: [] });
    const { items } = addExtraction(record, ex, "paste", 1, record.children[1].id);
    expect(items.every((i) => i.childIds.length === 0 || i.childIds[0] === record.children[1].id)).toBe(true);
    expect(items.some((i) => i.childIds[0] === record.children[1].id)).toBe(true);
  });

  it("applies item patches with validation", () => {
    const { record } = createFamily();
    const { items } = addExtraction(record, mockExtraction(ctx), "sample", 1);
    const it0 = items[0];
    const patched = applyItemPatch(it0, { status: "done", title: "  New title ", date: "bad", time: "25:00", amount: "12", type: "payment", bogus: 1 });
    expect(patched.status).toBe("done");
    expect(patched.title).toBe("New title");
    expect(patched.date).toBe(it0.date); // invalid date ignored
    expect(patched.time).toBe(it0.time); // invalid time ignored
    expect(patched.amount).toBe(it0.amount); // string amount ignored
    expect(patched.type).toBe("payment");
    const cleared = applyItemPatch(it0, { time: null, date: null });
    expect(cleared.time).toBeNull();
    expect(cleared.all_day).toBe(true);
    expect(cleared.date).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { suggestSettings } from "@/lib/assist";
import type { SettingsSuggestion } from "@/lib/schema";
import { applySuggestion, calendarLinks, platformOf } from "@/lib/setup";
import { createFamily } from "@/lib/store";

const empty: SettingsSuggestion = {
  reply: "",
  settings: { familyName: null, country: null, language: null, timezone: null, currency: null, dateOrder: null, weekStartsOn: null, digestEmail: null, digest: null, members: null },
  children: { add: [], remove: [], rename: [] },
  section: null,
};

describe("easy setup", () => {
  it("knows which calendar app the device has", () => {
    expect(platformOf("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe("apple");
    expect(platformOf("Mozilla/5.0 (Linux; Android 14; SM-S928B)")).toBe("android");
    expect(platformOf("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("other");
    expect(platformOf("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)", 5)).toBe("apple");
  });

  it("builds one-tap links for Google, Apple and Outlook", () => {
    const l = calendarLinks("https://parentdesk-app.vercel.app/api/calendar/abc_def.ics", "Kim family");
    expect(l.apple).toBe("webcal://parentdesk-app.vercel.app/api/calendar/abc_def.ics");
    expect(l.google).toContain("calendar.google.com/calendar/u/0/r?cid=https%3A%2F%2Fparentdesk-app.vercel.app");
    expect(l.outlook).toContain("outlook.live.com/calendar/0/addfromweb?url=https%3A%2F%2F");
    expect(l.outlook).toContain("name=Kim%20family");
  });

  it("turns a suggestion into settings, children and a list of changes", () => {
    const { record } = createFamily({ locale: "ko", timezone: "Asia/Seoul" });
    record.children = [{ id: "c1", name: "민준", color: "#2563eb" }];
    const s: SettingsSuggestion = {
      ...empty,
      settings: { ...empty.settings, country: "JP", weekStartsOn: "monday", digestEmail: "Mom@Example.com", members: ["엄마", "아빠", "엄마"] },
      children: { add: ["서연", " 서연 "], remove: ["없는아이"], rename: [{ from: "민준", to: "민준이" }] },
    };
    const out = applySuggestion(record.settings, record.children, s);
    expect(out.settings.country).toBe("JP");
    expect(out.settings.weekStart).toBe(1); // Korea starts on Sunday by default
    expect(out.settings.digestEmail).toBe("mom@example.com");
    expect(out.settings.digest).toBe(true); // an address switches the summary on
    expect(out.settings.members).toEqual(["엄마", "아빠"]);
    expect(out.children.map((c) => c.name)).toEqual(["민준이", "서연"]); // renamed, then added once (the repeat is dropped)
    expect(out.children[0].id).toBe("c1");
    expect(out.changes.map((c) => c.key)).toEqual(["country", "weekStart", "digestEmail", "digest", "members", "childRename", "childAdd"]);
  });

  it("changes nothing when the suggestion is empty", () => {
    const { record } = createFamily();
    const out = applySuggestion(record.settings, record.children, empty);
    expect(out.changes).toEqual([]);
    expect(out.settings).toEqual(record.settings);
  });

  it("answers in demo mode without a model", async () => {
    const { record } = createFamily();
    const out = await suggestSettings(record, "We moved to Japan, start the week on Sunday", "en", "2026-11-10");
    expect(out.mock).toBe(true);
    expect(out.result.settings.country).toBe("JP");
    expect(out.result.settings.weekStartsOn).toBe("sunday");
    const how = await suggestSettings(record, "How do I put this on my calendar?", "en", "2026-11-10");
    expect(how.result.section).toBe("calendar");
  });
});

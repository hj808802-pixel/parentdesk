import { describe, expect, it } from "vitest";
import { buildEvent, buildFeed, buildSingleIcs, feedTitle, foldLine, googleCalendarUrl, icsEscape, type FeedItem } from "@/lib/ics";

const base: FeedItem = {
  id: "abc123",
  type: "event",
  title: "Science Museum trip",
  description: "Bus leaves at 8:30; pack a lunch",
  date: "2026-11-14",
  end_date: null,
  time: "08:30",
  end_time: "15:00",
  all_day: false,
  location: "Science Museum",
  bring: ["Bag lunch", "Water bottle"],
  action_text: null,
  childNames: ["Mia"],
  updatedAt: "2026-11-05T10:00:00.000Z",
};

describe("ics", () => {
  it("escapes special characters", () => {
    expect(icsEscape("a,b;c\nd\\e")).toBe("a\\,b\\;c\\nd\\\\e");
  });

  it("folds long lines at 75 octets without splitting UTF-8", () => {
    const long = "SUMMARY:" + "가".repeat(60);
    const folded = foldLine(long);
    for (const line of folded.split("\r\n")) expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, "")).toBe(long);
  });

  it("builds a timed event with a reminder and the child's name", () => {
    const ev = buildEvent(base)!;
    expect(ev).toContain("DTSTART:20261114T083000");
    expect(ev).toContain("DTEND:20261114T150000");
    expect(ev).toContain("SUMMARY:Science Museum trip (Mia)");
    expect(ev).toContain("LOCATION:Science Museum");
    expect(ev).toContain("Bring: Bag lunch\\, Water bottle");
    expect(ev).toContain("TRIGGER:-PT12H");
    expect(ev).toContain("UID:abc123@parentdesk");
  });

  it("builds all-day and multi-day events with exclusive end dates", () => {
    const ev = buildEvent({ ...base, all_day: true, time: null, end_time: null, end_date: "2026-11-15" })!;
    expect(ev).toContain("DTSTART;VALUE=DATE:20261114");
    expect(ev).toContain("DTEND;VALUE=DATE:20261116");
    expect(ev).toContain("TRIGGER:-P1D");
  });

  it("prefixes due items and reminds three days ahead", () => {
    const ev = buildEvent({ ...base, type: "payment", time: null, all_day: true, title: "Pay trip fee" })!;
    expect(ev).toContain("SUMMARY:Pay: Pay trip fee (Mia)");
    expect(ev).toContain("TRIGGER:-P3D");
    expect(feedTitle({ ...base, type: "consent", childNames: [] }, { deadline: "Due", todo: "To do", payment: "Pay", consent: "Sign", bring: "Bring" })).toBe("Sign: Science Museum trip");
  });

  it("skips items without a date and wraps a calendar", () => {
    expect(buildEvent({ ...base, date: null })).toBeNull();
    const feed = buildFeed("Smith · ParentDesk", [base, { ...base, id: "x", date: null }]);
    expect(feed.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(feed).toContain("X-WR-CALNAME:Smith · ParentDesk");
    expect(feed.match(/BEGIN:VEVENT/g)?.length).toBe(1);
    expect(feed.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(buildSingleIcs({ ...base, date: null })).toBe("");
  });

  it("makes a Google Calendar link", () => {
    const url = new URL(googleCalendarUrl(base));
    expect(url.searchParams.get("dates")).toBe("20261114T083000/20261114T150000");
    expect(url.searchParams.get("text")).toBe("Science Museum trip (Mia)");
    expect(url.searchParams.get("location")).toBe("Science Museum");
    expect(googleCalendarUrl({ ...base, date: null })).toBe("#");
  });
});

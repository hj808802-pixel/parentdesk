import { describe, expect, it } from "vitest";
import { addDays, bucketOf, daysBetween, formatDate, formatMoney, formatTime, isHhMm, isIsoDate, startOfWeek, todayIn, weekday } from "@/lib/dates";

describe("dates", () => {
  it("validates ISO dates and times", () => {
    expect(isIsoDate("2026-11-05")).toBe(true);
    expect(isIsoDate("2026-13-05")).toBe(false);
    expect(isIsoDate("5 Nov 2026")).toBe(false);
    expect(isHhMm("08:30")).toBe(true);
    expect(isHhMm("8:30")).toBe(false);
    expect(isHhMm("24:00")).toBe(false);
  });

  it("adds and subtracts days across month ends", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-11-05", "2026-11-14")).toBe(9);
    expect(daysBetween("2026-11-14", "2026-11-05")).toBe(-9);
  });

  it("knows weekdays and week starts", () => {
    expect(weekday("2026-11-05")).toBe(4); // Thursday
    expect(startOfWeek("2026-11-05", 1)).toBe("2026-11-02");
    expect(startOfWeek("2026-11-05", 0)).toBe("2026-11-01");
    expect(startOfWeek("2026-11-01", 1)).toBe("2026-10-26");
  });

  it("gives today's date in a zone", () => {
    const now = new Date("2026-11-05T23:30:00Z");
    expect(todayIn("UTC", now)).toBe("2026-11-05");
    expect(todayIn("Asia/Seoul", now)).toBe("2026-11-06");
    expect(todayIn("America/Los_Angeles", now)).toBe("2026-11-05");
    expect(todayIn("Not/AZone", now)).toBe("2026-11-05");
  });

  it("buckets dates for the week view", () => {
    const today = "2026-11-05"; // Thursday, week starts Monday
    expect(bucketOf(null, today, 1)).toBe("noDate");
    expect(bucketOf("2026-11-04", today, 1)).toBe("overdue");
    expect(bucketOf("2026-11-05", today, 1)).toBe("today");
    expect(bucketOf("2026-11-06", today, 1)).toBe("tomorrow");
    expect(bucketOf("2026-11-08", today, 1)).toBe("thisWeek");
    expect(bucketOf("2026-11-09", today, 1)).toBe("nextWeek");
    expect(bucketOf("2026-11-16", today, 1)).toBe("later");
    // Sunday-start weeks: Sunday 8 Nov is next week
    expect(bucketOf("2026-11-08", today, 0)).toBe("nextWeek");
  });

  it("formats for people without depending on the machine zone", () => {
    expect(formatDate("2026-11-14", "en", { month: "short", day: "numeric" })).toBe("Nov 14");
    expect(formatTime("15:30", "en-GB")).toBe("15:30");
    expect(formatMoney(12, "USD", "en-US")).toBe("$12.00");
    expect(formatMoney(15000, "KRW", "ko-KR")).toContain("15,000");
    expect(formatMoney(5, null, "en")).toBe("5");
  });
});

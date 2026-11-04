// Date helpers that work on ISO strings (YYYY-MM-DD) so they never depend on the server's
// clock zone. Pure functions, unit-tested.

export function isIsoDate(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

export function isHhMm(s: unknown): s is string {
  return typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

// Today's date in a time zone, as YYYY-MM-DD. Falls back to UTC for an unknown zone.
export function todayIn(timezone: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// b - a in whole days.
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

// 0 = Sunday ... 6 = Saturday, for an ISO date.
export function weekday(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

// Next weekday (0 Sunday … 6 Saturday) on or after an ISO date.
export function nextWeekday(fromIso: string, wd: number): string {
  return addDays(fromIso, (wd - weekday(fromIso) + 7) % 7);
}

export function startOfWeek(iso: string, weekStart: 0 | 1): string {
  const wd = weekday(iso);
  const back = (wd - weekStart + 7) % 7;
  return addDays(iso, -back);
}

// Formats an ISO date for people, in the UI locale, independent of the machine's zone.
export function formatDate(iso: string, locale: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" }): string {
  const d = new Date(`${iso}T00:00:00Z`);
  try {
    return new Intl.DateTimeFormat(locale, { timeZone: "UTC", ...opts }).format(d);
  } catch {
    return iso;
  }
}

export function formatDateLong(iso: string, locale: string): string {
  return formatDate(iso, locale, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

export function formatTime(hhmm: string, locale: string): string {
  if (!isHhMm(hhmm)) return hhmm;
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(Date.UTC(2000, 0, 1, h, m));
  try {
    return new Intl.DateTimeFormat(locale, { timeZone: "UTC", hour: "numeric", minute: "2-digit" }).format(d);
  } catch {
    return hhmm;
  }
}

export function formatMoney(amount: number, currency: string | null, locale: string): string {
  try {
    if (currency) return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount);
  } catch {
    /* unknown currency code */
  }
  return `${new Intl.NumberFormat(locale).format(amount)}${currency ? ` ${currency}` : ""}`;
}

// Buckets for the week view. `todayIso` is the family's today.
export type Bucket = "overdue" | "today" | "tomorrow" | "thisWeek" | "nextWeek" | "later" | "noDate";

export function bucketOf(date: string | null, todayIso: string, weekStart: 0 | 1): Bucket {
  if (!date) return "noDate";
  const diff = daysBetween(todayIso, date);
  if (diff < 0) return "overdue";
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  const weekEnd = addDays(startOfWeek(todayIso, weekStart), 6);
  if (date <= weekEnd) return "thisWeek";
  const nextWeekEnd = addDays(weekEnd, 7);
  if (date <= nextWeekEnd) return "nextWeek";
  return "later";
}

export const BUCKET_ORDER: Bucket[] = ["overdue", "today", "tomorrow", "thisWeek", "nextWeek", "later", "noDate"];

// Month key for usage counters: "2026-11".
export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

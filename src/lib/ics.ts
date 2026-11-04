import { addDays, isHhMm, isIsoDate } from "./dates";
import type { ItemType } from "./schema";

// iCalendar output: the family feed that calendar apps subscribe to, one-item .ics files,
// and Google Calendar template links. Times are "floating" (no zone), which calendar apps
// show in the device's own zone; a family lives in one zone, so that is the right reading.

export type FeedItem = {
  id: string;
  type: ItemType;
  title: string;
  description: string;
  date: string | null;
  end_date: string | null;
  time: string | null;
  end_time: string | null;
  all_day: boolean;
  location: string | null;
  bring: string[];
  action_text: string | null;
  childNames: string[];
  updatedAt: string;
};

// Words put in front of titles so a glance at the calendar says what kind of thing it is.
export type FeedLabels = Record<Exclude<ItemType, "event" | "info">, string> & { bring: string };

export const DEFAULT_LABELS: FeedLabels = { deadline: "Due", todo: "To do", payment: "Pay", consent: "Sign", bring: "Bring" };

export function icsEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

// RFC 5545 line folding: 75 octets per line, continuation lines start with a space.
// TextEncoder/TextDecoder rather than Buffer, so this also runs in the browser.
export function foldLine(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const decoder = new TextDecoder();
  const out: string[] = [];
  let i = 0;
  let first = true;
  while (i < bytes.length) {
    const limit = first ? 75 : 74;
    let end = Math.min(i + limit, bytes.length);
    // do not split a UTF-8 sequence
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    out.push((first ? "" : " ") + decoder.decode(bytes.subarray(i, end)));
    i = end;
    first = false;
  }
  return out.join("\r\n");
}

function stamp(d = new Date()): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function compact(iso: string): string {
  return iso.replace(/-/g, "");
}

export function feedTitle(item: FeedItem, labels: FeedLabels): string {
  const who = item.childNames.length ? ` (${item.childNames.join(", ")})` : "";
  const prefix = item.type === "event" || item.type === "info" ? "" : `${labels[item.type]}: `;
  return `${prefix}${item.title}${who}`;
}

function feedDescription(item: FeedItem, labels: FeedLabels): string {
  const parts = [item.description];
  if (item.action_text) parts.push(item.action_text);
  if (item.bring.length) parts.push(`${labels.bring}: ${item.bring.join(", ")}`);
  return parts.filter(Boolean).join("\n");
}

// One VEVENT, or null when the item has no usable date.
export function buildEvent(item: FeedItem, labels: FeedLabels = DEFAULT_LABELS, uidDomain = "parentdesk"): string | null {
  if (!item.date || !isIsoDate(item.date)) return null;
  const lines = ["BEGIN:VEVENT", `UID:${item.id}@${uidDomain}`, `DTSTAMP:${stamp()}`];
  const timed = !item.all_day && item.time && isHhMm(item.time);
  if (timed) {
    const start = `${compact(item.date)}T${item.time!.replace(":", "")}00`;
    lines.push(`DTSTART:${start}`);
    if (item.end_time && isHhMm(item.end_time)) {
      const endDate = item.end_date && isIsoDate(item.end_date) ? item.end_date : item.date;
      lines.push(`DTEND:${compact(endDate)}T${item.end_time.replace(":", "")}00`);
    }
  } else {
    const endExclusive = item.end_date && isIsoDate(item.end_date) && item.end_date >= item.date ? addDays(item.end_date, 1) : addDays(item.date, 1);
    lines.push(`DTSTART;VALUE=DATE:${compact(item.date)}`, `DTEND;VALUE=DATE:${compact(endExclusive)}`);
  }
  lines.push(`SUMMARY:${icsEscape(feedTitle(item, labels))}`);
  const desc = feedDescription(item, labels);
  if (desc) lines.push(`DESCRIPTION:${icsEscape(desc)}`);
  if (item.location) lines.push(`LOCATION:${icsEscape(item.location)}`);
  if (item.updatedAt) lines.push(`LAST-MODIFIED:${stamp(new Date(item.updatedAt))}`);
  // Reminder: the day before for events, three days before for anything that must be
  // handed in, paid or signed.
  const trigger = item.type === "event" || item.type === "info" ? (timed ? "-PT12H" : "-P1D") : "-P3D";
  lines.push("BEGIN:VALARM", `TRIGGER:${trigger}`, "ACTION:DISPLAY", `DESCRIPTION:${icsEscape(feedTitle(item, labels))}`, "END:VALARM", "END:VEVENT");
  return lines.join("\r\n");
}

export function buildCalendar(name: string, events: string[]): string {
  const head = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ParentDesk//Family feed//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${icsEscape(name)}`, "X-PUBLISHED-TTL:PT1H"];
  const body = [...head, ...events, "END:VCALENDAR"].join("\r\n");
  return body
    .split("\r\n")
    .map(foldLine)
    .join("\r\n") + "\r\n";
}

export function buildFeed(name: string, items: FeedItem[], labels: FeedLabels = DEFAULT_LABELS): string {
  const events = items.map((i) => buildEvent(i, labels)).filter((e): e is string => Boolean(e));
  return buildCalendar(name, events);
}

export function buildSingleIcs(item: FeedItem, labels: FeedLabels = DEFAULT_LABELS): string {
  const ev = buildEvent(item, labels);
  return ev ? buildCalendar(feedTitle(item, labels), [ev]) : "";
}

export function googleCalendarUrl(item: FeedItem, labels: FeedLabels = DEFAULT_LABELS): string {
  if (!item.date || !isIsoDate(item.date)) return "#";
  const timed = !item.all_day && item.time && isHhMm(item.time);
  let dates: string;
  if (timed) {
    const endTime = item.end_time && isHhMm(item.end_time) ? item.end_time : addHour(item.time!);
    dates = `${compact(item.date)}T${item.time!.replace(":", "")}00/${compact(item.date)}T${endTime.replace(":", "")}00`;
  } else {
    const endExclusive = item.end_date && isIsoDate(item.end_date) && item.end_date >= item.date ? addDays(item.end_date, 1) : addDays(item.date, 1);
    dates = `${compact(item.date)}/${compact(endExclusive)}`;
  }
  const params = new URLSearchParams({ action: "TEMPLATE", text: feedTitle(item, labels), dates, details: feedDescription(item, labels) });
  if (item.location) params.set("location", item.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function addHour(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return `${String(Math.min(23, h + 1)).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// Browser only.
export function downloadIcs(item: FeedItem, labels: FeedLabels = DEFAULT_LABELS) {
  const ics = buildSingleIcs(item, labels);
  if (!ics) return;
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${item.date}-${item.title.replace(/[^\w\d-]+/g, "_").slice(0, 40)}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}

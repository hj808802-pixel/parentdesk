import { addDays, bucketOf, daysBetween, formatDate, formatMoney, formatTime } from "./dates";
import type { Item, Source } from "./types";

// The numbers on the home screen, from the family's items and notices. Pure: the browser
// computes them from the loaded family document.

export type Summary = {
  needsAction: number; // open, needs the parent, due within 14 days or undated (past due included)
  overdue: number;
  thisWeek: number; // open items dated today through the end of this week
  toPay: { count: number; totals: Record<string, number> }; // open payments, summed per currency
  toSign: number; // open forms
  next: Item[]; // the next three dated open items from today on
  recent: Source[]; // the last three notices
  roomNews: Record<string, number>; // room id -> notices that arrived in the last seven days
};

export function byDate(a: Item, b: Item): number {
  if (!a.date && !b.date) return a.createdAt < b.createdAt ? 1 : -1;
  if (!a.date) return 1;
  if (!b.date) return -1;
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return (a.time ?? "99") < (b.time ?? "99") ? -1 : 1;
}

export function summarize(items: Item[], sources: Source[], todayIso: string, weekStart: 0 | 1, nowIso: string = new Date().toISOString()): Summary {
  const open = items.filter((it) => it.status === "open");
  const needsAction = open.filter((it) => it.requires_action && (!it.date || daysBetween(todayIso, it.date) <= 14)).length;
  const overdue = open.filter((it) => it.date && daysBetween(todayIso, it.date) < 0).length;
  const thisWeek = open.filter((it) => {
    const b = bucketOf(it.date, todayIso, weekStart);
    return b === "today" || b === "tomorrow" || b === "thisWeek";
  }).length;
  const payments = open.filter((it) => it.type === "payment");
  const totals: Record<string, number> = {};
  for (const p of payments) {
    if (p.amount == null) continue;
    const cur = p.currency ?? "";
    totals[cur] = Math.round(((totals[cur] ?? 0) + p.amount) * 100) / 100;
  }
  const toSign = open.filter((it) => it.type === "consent").length;
  const next = open
    .filter((it) => it.date && daysBetween(todayIso, it.date) >= 0)
    .sort(byDate)
    .slice(0, 3);
  const recent = [...sources].sort((a, b) => (a.ts < b.ts ? 1 : -1)).slice(0, 3);
  const weekAgo = new Date(Date.parse(nowIso) - 7 * 86400000).toISOString();
  const roomNews: Record<string, number> = {};
  for (const s of sources) if (s.roomId && s.ts >= weekAgo) roomNews[s.roomId] = (roomNews[s.roomId] ?? 0) + 1;
  return { needsAction, overdue, thisWeek, toPay: { count: payments.length, totals }, toSign, next, recent, roomNews };
}

// ---- things to pack today and tomorrow ----

export type BringEntry = { item: Item; dayOffset: 0 | 1 };

export function bringList(items: Item[], todayIso: string): BringEntry[] {
  const tomorrow = addDays(todayIso, 1);
  return items
    .filter((it) => it.status === "open" && it.bring.length > 0 && (it.date === todayIso || it.date === tomorrow))
    .sort(byDate)
    .map((it) => ({ item: it, dayOffset: it.date === todayIso ? 0 : 1 }));
}

// ---- the week in two or three sentences, from dictionary templates (no model) ----

export type BriefLabels = { overdue: string; due: string; events: string; quiet: string; more: string };
type Fmt = (template: string, vars: Record<string, string | number>) => string;

export function weekBrief(items: Item[], todayIso: string, tag: string, labels: BriefLabels, fmt: Fmt): string[] {
  const open = items.filter((it) => it.status === "open");
  const in6 = addDays(todayIso, 6);
  const out: string[] = [];
  const overdue = open.filter((it) => it.date && it.date < todayIso).length;
  if (overdue) out.push(fmt(labels.overdue, { n: overdue }));
  const due = open.filter((it) => it.date && it.date >= todayIso && it.date <= in6 && it.type !== "event" && it.type !== "info").sort(byDate);
  if (due.length) {
    const first = due[0].date as string;
    const same = due.filter((d) => d.date === first);
    const list = same
      .slice(0, 3)
      .map((d) => (d.amount != null ? `${d.title} (${formatMoney(d.amount, d.currency, tag)})` : d.title))
      .join(", ");
    out.push(fmt(labels.due, { date: formatDate(first, tag, { weekday: "short", day: "numeric" }), list: same.length > 3 ? `${list} ${fmt(labels.more, { n: same.length - 3 })}` : list }));
  }
  const events = open.filter((it) => it.type === "event" && it.date && it.date >= todayIso && it.date <= in6).sort(byDate);
  if (events.length) {
    const list = events
      .slice(0, 3)
      .map((e) => `${formatDate(e.date as string, tag, { weekday: "short" })}${e.time ? ` ${formatTime(e.time, tag)}` : ""} ${e.title}`)
      .join(", ");
    out.push(fmt(labels.events, { list: events.length > 3 ? `${list} ${fmt(labels.more, { n: events.length - 3 })}` : list }));
  }
  if (out.length === 0) out.push(labels.quiet);
  return out;
}

// ---- two children, one time slot ----

export type Clash = { date: string; a: Item; b: Item };

const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

// Open items on the same day whose times overlap and whose children are different (an
// item for the whole family never clashes). An item without an end time is taken as an hour.
export function findClashes(items: Item[], max = 5): Clash[] {
  const timed = items.filter((it) => it.status === "open" && it.date && it.time && it.childIds.length > 0).sort(byDate);
  const span = (it: Item): [number, number] => {
    const s = toMinutes(it.time as string);
    const e = it.end_time ? toMinutes(it.end_time) : s + 60;
    return [s, Math.max(e, s + 1)];
  };
  const out: Clash[] = [];
  for (let i = 0; i < timed.length && out.length < max; i++) {
    for (let j = i + 1; j < timed.length && out.length < max; j++) {
      const a = timed[i];
      const b = timed[j];
      if (a.date !== b.date) continue;
      if (a.childIds.some((id) => b.childIds.includes(id))) continue;
      const [as, ae] = span(a);
      const [bs, be] = span(b);
      if (as < be && bs < ae) out.push({ date: a.date as string, a, b });
    }
  }
  return out;
}

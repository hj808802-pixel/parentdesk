import { bucketOf, daysBetween } from "./dates";
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

import { addDays, startOfWeek } from "./dates";
import type { Item } from "./types";

// The month view: a grid of days and the items that fall on each day. Pure functions over
// ISO dates; the browser does the rendering.

export type MonthCell = { iso: string; inMonth: boolean };

const MAX_SPAN_DAYS = 60;

// "2026-11" plus or minus whole months.
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// Whole weeks covering the month, from the week that holds the 1st to the week that holds
// the last day, each cell flagged as inside or outside the month.
export function monthGrid(month: string, weekStart: 0 | 1): MonthCell[] {
  const first = `${month}-01`;
  const last = `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;
  const start = startOfWeek(first, weekStart);
  const end = addDays(startOfWeek(last, weekStart), 6);
  const cells: MonthCell[] = [];
  for (let iso = start; iso <= end; iso = addDays(iso, 1)) cells.push({ iso, inMonth: iso.slice(0, 7) === month });
  return cells;
}

// Items by day. A multi-day event sits on every day it spans (capped). Dismissed items are
// left out; done ones stay so the month shows what happened.
export function itemsByDay(items: Item[]): Map<string, Item[]> {
  const out = new Map<string, Item[]>();
  const put = (iso: string, it: Item) => out.set(iso, [...(out.get(iso) ?? []), it]);
  for (const it of items) {
    if (!it.date || it.status === "dismissed") continue;
    put(it.date, it);
    if (it.end_date && it.end_date > it.date) {
      let iso = addDays(it.date, 1);
      for (let n = 0; iso <= it.end_date && n < MAX_SPAN_DAYS; n++, iso = addDays(iso, 1)) put(iso, it);
    }
  }
  for (const [iso, list] of out) out.set(iso, list.sort((a, b) => ((a.time ?? "99") < (b.time ?? "99") ? -1 : a.time === b.time ? (a.title < b.title ? -1 : 1) : 1)));
  return out;
}

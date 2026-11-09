"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { itemsByDay, monthGrid, shiftMonth } from "@/lib/calendar";
import { addDays, formatDate, startOfWeek, todayIn } from "@/lib/dates";
import { useFamily } from "@/lib/family-context";
import { useI18n } from "@/lib/i18n/context";
import { fmt } from "@/lib/i18n";
import { LOCALE_TAGS, localePath } from "@/lib/i18n/locales";
import type { Item } from "@/lib/store";
import { BTN_PRIMARY, BTN_SECONDARY, BTN_SMALL, CARD } from "@/lib/ui";
import ItemCard from "./ItemCard";
import Landing from "./Landing";

// The month: one dot per child on each day that has something, tap a day to see its items.
// The calendar feed (for the phone's own calendar app) is offered underneath.

export default function CalendarView() {
  const { locale, t } = useI18n();
  const { family, loading, patchItem, removeItem } = useFamily();
  const tag = LOCALE_TAGS[locale];
  const todayIso = todayIn(family?.settings.timezone ?? "UTC");
  // Until the parent picks a day, both follow today in the family's time zone (which only
  // becomes known once the family has loaded).
  const [pickedMonth, setMonth] = useState<string | null>(null);
  const [picked, setSelected] = useState<string | null>(null);
  const month = pickedMonth ?? todayIso.slice(0, 7);
  const selected = picked ?? todayIso;
  const weekStart = family?.settings.weekStart ?? 1;
  const cells = useMemo(() => monthGrid(month, weekStart), [month, weekStart]);
  const byDay = useMemo(() => (family ? itemsByDay(family.items) : new Map<string, Item[]>()), [family]);

  if (loading) return <p className="p-8 text-center text-sm text-zinc-500">{t.common.loading}</p>;
  if (!family) return <Landing compact />;

  const colorOf = new Map(family.children.map((c) => [c.id, c.color]));
  const weekdayLabels = Array.from({ length: 7 }, (_, i) => formatDate(addDays(startOfWeek(todayIso, weekStart), i), tag, { weekday: "narrow" }));
  const dayItems = byDay.get(selected) ?? [];
  const monthLabel = formatDate(`${month}-01`, tag, { year: "numeric", month: "long" });

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t.calendar.title}</h1>
        <Link href={localePath(locale, "/add")} className={BTN_PRIMARY}>
          + {t.nav.add}
        </Link>
      </div>

      <section className={`${CARD} mt-4`}>
        <div className="flex items-center justify-between gap-2">
          <button type="button" className={BTN_SMALL} aria-label={t.calendar.prev} onClick={() => setMonth(shiftMonth(month, -1))}>
            ‹
          </button>
          <p className="font-semibold">{monthLabel}</p>
          <div className="flex gap-1">
            <button
              type="button"
              className={BTN_SMALL}
              onClick={() => {
                setMonth(null);
                setSelected(null);
              }}
            >
              {t.calendar.today}
            </button>
            <button type="button" className={BTN_SMALL} aria-label={t.calendar.next} onClick={() => setMonth(shiftMonth(month, 1))}>
              ›
            </button>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[11px] text-zinc-500">
          {weekdayLabels.map((w, i) => (
            <div key={i}>{w}</div>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {cells.map((cell) => {
            const list = byDay.get(cell.iso) ?? [];
            const open = list.filter((it) => it.status === "open");
            const dots = [...new Set(list.flatMap((it) => (it.childIds.length ? it.childIds.map((id) => colorOf.get(id) ?? "#a1a1aa") : ["#a1a1aa"])))].slice(0, 4);
            const isToday = cell.iso === todayIso;
            const isSelected = cell.iso === selected;
            return (
              <button
                key={cell.iso}
                type="button"
                onClick={() => setSelected(cell.iso)}
                aria-pressed={isSelected}
                aria-label={`${formatDate(cell.iso, tag, { month: "long", day: "numeric" })}${list.length ? `, ${fmt(t.items.count, { n: list.length })}` : ""}`}
                className={`flex h-12 flex-col items-center justify-start rounded-lg pt-1 text-sm ${
                  isSelected ? "bg-indigo-600 text-white" : isToday ? "bg-indigo-50 font-semibold text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-200" : cell.inMonth ? "hover:bg-zinc-100 dark:hover:bg-zinc-800" : "text-zinc-400 dark:text-zinc-600"
                }`}
              >
                <span className={open.length && !isSelected ? "font-semibold" : ""}>{Number(cell.iso.slice(8, 10))}</span>
                <span className="mt-1 flex h-2 gap-0.5">
                  {dots.map((c, i) => (
                    <span key={i} className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: isSelected ? "#fff" : c }} aria-hidden />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="mt-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">{formatDate(selected, tag, { weekday: "long", month: "long", day: "numeric" })}</h2>
        {dayItems.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">{t.calendar.empty}</p>
        ) : (
          <div className="mt-2 grid gap-3">
            {dayItems.map((it) => (
              <ItemCard key={it.id} item={it} childrenList={family.children} timezone={family.settings.timezone} members={family.settings.members} onPatch={patchItem} onRemove={removeItem} />
            ))}
          </div>
        )}
      </section>

      <aside className={`${CARD} mt-8 border-indigo-200 bg-indigo-50 dark:border-indigo-900 dark:bg-indigo-950/40`}>
        <p className="font-semibold">{t.home.subscribeTitle}</p>
        <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">{t.home.subscribeBody}</p>
        <Link href={localePath(locale, "/settings#calendar")} className={`${BTN_SECONDARY} mt-3`}>
          {t.home.subscribeCta}
        </Link>
      </aside>
    </main>
  );
}

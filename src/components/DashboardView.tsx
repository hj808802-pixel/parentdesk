"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { bringList, summarize, weekBrief } from "@/lib/dashboard";
import { formatDate, formatDateLong, formatMoney, formatTime, todayIn } from "@/lib/dates";
import { useFamily } from "@/lib/family-context";
import { useI18n } from "@/lib/i18n/context";
import { fmt } from "@/lib/i18n";
import { LOCALE_TAGS, localePath } from "@/lib/i18n/locales";
import { BTN_PRIMARY, BTN_SECONDARY, CARD, TYPE_STYLES } from "@/lib/ui";
import AskBox from "./AskBox";
import ChildChips from "./ChildChips";
import Landing from "./Landing";

// The home screen once a family exists: today at a glance, the next few things, the latest
// notices, the class rooms the family follows, and the assistant. The week itself lives at
// /week; this page points to it.

export default function DashboardView() {
  const { locale, t } = useI18n();
  const { family, loading } = useFamily();
  const tag = LOCALE_TAGS[locale];
  const todayIso = todayIn(family?.settings.timezone ?? "UTC");
  const summary = useMemo(() => (family ? summarize(family.items, family.sources, todayIso, family.settings.weekStart) : null), [family, todayIso]);
  const brief = useMemo(
    () => (family ? weekBrief(family.items, todayIso, tag, { overdue: t.dash.briefOverdue, due: t.dash.briefDue, events: t.dash.briefEvents, quiet: t.dash.briefQuiet, more: t.dash.briefMore }, fmt) : []),
    [family, todayIso, tag, t],
  );
  const packing = useMemo(() => (family ? bringList(family.items, todayIso) : []), [family, todayIso]);
  // Ticks live in this browser only and reset with the day.
  const [ticked, setTicked] = useState<string[]>([]);
  const tickKey = `pd_bring_${todayIso}`;
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reading local storage once per day
      setTicked(JSON.parse(window.localStorage.getItem(tickKey) ?? "[]") as string[]);
    } catch {
      setTicked([]);
    }
  }, [tickKey]);
  const toggleTick = (key: string) =>
    setTicked((cur) => {
      const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
      try {
        window.localStorage.setItem(tickKey, JSON.stringify(next));
      } catch {
        /* storage unavailable */
      }
      return next;
    });

  if (loading) return <p className="p-8 text-center text-sm text-zinc-500">{t.common.loading}</p>;
  if (!family || !summary) return <Landing />;

  const hasAny = family.items.length > 0 || family.sources.length > 0;
  const payEntries = Object.entries(summary.toPay.totals);
  const payText = payEntries.length ? `${formatMoney(payEntries[0][1], payEntries[0][0] || family.settings.currency, tag)}${payEntries.length > 1 ? " +" : ""}` : String(summary.toPay.count);
  const rooms = family.rooms ?? [];

  const actions = [
    { href: "/add", label: t.dash.actions.add, icon: "＋", primary: true },
    { href: "/week", label: t.dash.actions.week, icon: "▣", primary: false },
    { href: "/settings#calendar", label: t.dash.actions.calendar, icon: "◷", primary: false },
    { href: "/teach", label: t.dash.actions.teach, icon: "✎", primary: false },
  ];

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <header>
        <p className="text-xs text-zinc-500">{formatDateLong(todayIso, tag)}</p>
        <h1 dir="auto" className="mt-1 text-2xl font-bold">{family.settings.familyName ? fmt(t.dash.greeting, { name: family.settings.familyName }) : t.dash.greetingNoName}</h1>
        <div className="mt-2 text-sm">
          {family.children.length > 0 ? (
            <ChildChips childrenList={family.children} ids={family.children.map((c) => c.id)} />
          ) : (
            <Link href={localePath(locale, "/settings")} className="text-zinc-600 underline underline-offset-4 dark:text-zinc-400">
              {t.dash.childrenHint}
            </Link>
          )}
        </div>
      </header>

      {!hasAny && (
        <section className={`${CARD} mt-5 border-indigo-200 bg-indigo-50 dark:border-indigo-900 dark:bg-indigo-950/40`}>
          <p className="font-semibold">{t.dash.startTitle}</p>
          <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">{t.dash.startBody}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href={localePath(locale, "/add")} className={BTN_PRIMARY}>
              {t.landing.ctaAdd}
            </Link>
            <Link href={localePath(locale, "/add?sample=1")} className={BTN_SECONDARY}>
              {t.landing.ctaSample}
            </Link>
          </div>
        </section>
      )}

      {hasAny && (
        <section className={`${CARD} mt-5 border-indigo-200 dark:border-indigo-900`}>
          <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-300">{t.dash.brief}</p>
          <p dir="auto" className="mt-1 text-sm leading-relaxed">{brief.join(" ")}</p>
        </section>
      )}

      {packing.length > 0 && (
        <section className={`${CARD} mt-4 border-sky-200 dark:border-sky-900`}>
          <p className="text-xs font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300">{t.dash.bring}</p>
          <ul className="mt-2 grid gap-3">
            {packing.map(({ item, dayOffset }) => (
              <li key={item.id} className="text-sm">
                <p className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                  <span className="rounded-full bg-sky-100 px-2 py-0.5 font-medium text-sky-900 dark:bg-sky-900/50 dark:text-sky-200">{dayOffset === 0 ? t.dash.bringToday : t.dash.bringTomorrow}</span>
                  <span dir="auto" className="font-medium text-zinc-800 dark:text-zinc-200">{item.title}</span>
                  <ChildChips childrenList={family.children} ids={item.childIds} />
                </p>
                <ul className="mt-1 grid gap-1">
                  {item.bring.map((b, i) => {
                    const key = `${item.id}:${i}`;
                    const on = ticked.includes(key);
                    return (
                      <li key={key}>
                        <label className={`flex items-center gap-2 ${on ? "text-zinc-400 line-through" : ""}`}>
                          <input type="checkbox" checked={on} onChange={() => toggleTick(key)} />
                          <span dir="auto">{b}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}

      {hasAny && (
        <section className="mt-5 grid grid-cols-2 gap-3" aria-label={t.dash.title}>
          <Link href={localePath(locale, "/week")} className={`${CARD} block ${summary.needsAction ? "border-rose-200 dark:border-rose-900" : ""}`}>
            <p className="text-xs text-zinc-500">{t.dash.needsAction}</p>
            <p className={`mt-1 text-3xl font-bold tabular-nums ${summary.needsAction ? "text-rose-700 dark:text-rose-300" : ""}`}>{summary.needsAction}</p>
            {summary.overdue > 0 && <p className="text-xs text-red-600 dark:text-red-400">{fmt(t.dash.overdue, { n: summary.overdue })}</p>}
          </Link>
          <Link href={localePath(locale, "/week")} className={`${CARD} block`}>
            <p className="text-xs text-zinc-500">{t.dash.thisWeek}</p>
            <p className="mt-1 text-3xl font-bold tabular-nums">{summary.thisWeek}</p>
            <p className="text-xs text-zinc-500">{t.dash.thisWeekSub}</p>
          </Link>
          <Link href={localePath(locale, "/items")} className={`${CARD} block`}>
            <p className="text-xs text-zinc-500">{t.dash.toPay}</p>
            <p className="mt-1 truncate text-2xl font-bold tabular-nums">{payText}</p>
            <p className="text-xs text-zinc-500">{fmt(t.dash.toPaySub, { n: summary.toPay.count })}</p>
          </Link>
          <Link href={localePath(locale, "/items")} className={`${CARD} block`}>
            <p className="text-xs text-zinc-500">{t.dash.toSign}</p>
            <p className="mt-1 text-3xl font-bold tabular-nums">{summary.toSign}</p>
            <p className="text-xs text-zinc-500">{fmt(t.dash.toSignSub, { n: summary.toSign })}</p>
          </Link>
        </section>
      )}

      <nav aria-label={t.dash.title} className="mt-5 grid grid-cols-4 gap-2">
        {actions.map((a) => (
          <Link
            key={a.href}
            href={localePath(locale, a.href)}
            className={`flex flex-col items-center gap-1 rounded-2xl border px-2 py-3 text-center text-xs font-medium ${
              a.primary ? "border-indigo-600 bg-indigo-600 text-white" : "border-zinc-200 bg-white text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300"
            }`}
          >
            <span aria-hidden className="text-lg leading-none">
              {a.icon}
            </span>
            <span className="line-clamp-2 break-keep leading-tight">{a.label}</span>
          </Link>
        ))}
      </nav>

      {hasAny && (
        <section className={`${CARD} mt-6`}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold">{t.dash.next}</h2>
            <Link href={localePath(locale, "/week")} className="text-xs underline underline-offset-4">
              {t.dash.openWeek}
            </Link>
          </div>
          {summary.next.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-500">{t.dash.nextEmpty}</p>
          ) : (
            <ul className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800">
              {summary.next.map((it) => (
                <li key={it.id} className="flex items-start gap-3 py-2 text-sm">
                  <span className="w-24 shrink-0 text-xs text-zinc-500">
                    {formatDate(it.date as string, tag)}
                    {it.time ? <span className="block">{formatTime(it.time, tag)}</span> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`mr-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${TYPE_STYLES[it.type].badge}`}>{t.item.types[it.type]}</span>
                    <span dir="auto" className="font-medium">{it.title}</span>
                    <span className="mt-0.5 block">
                      <ChildChips childrenList={family.children} ids={it.childIds} />
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {hasAny && (
        <section className={`${CARD} mt-4`}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold">{t.dash.recent}</h2>
            <Link href={localePath(locale, "/sources")} className="text-xs underline underline-offset-4">
              {t.dash.allNotices}
            </Link>
          </div>
          {summary.recent.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-500">{t.dash.recentEmpty}</p>
          ) : (
            <ul className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800">
              {summary.recent.map((s) => (
                <li key={s.id} className="py-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-medium dark:bg-zinc-800">{t.sources.kinds[s.kind]}</span>
                    <span>{formatDate(s.ts.slice(0, 10), tag, { month: "short", day: "numeric" })}</span>
                    <span>· {fmt(t.sources.itemCount, { n: family.items.filter((it) => it.sourceId === s.id).length })}</span>
                  </div>
                  <p dir="auto" className="mt-0.5 font-medium">{s.title}</p>
                  <p dir="auto" className="text-xs text-zinc-500">{s.sender}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className={`${CARD} mt-4 border-emerald-200 dark:border-emerald-900`}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">{t.dash.rooms}</h2>
          <Link href={localePath(locale, "/settings")} className="text-xs underline underline-offset-4">
            {t.dash.manageRooms}
          </Link>
        </div>
        {rooms.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{t.dash.roomsEmpty}</p>
        ) : (
          <ul className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800">
            {rooms.map((r) => {
              const n = summary.roomNews[r.roomId] ?? 0;
              return (
                <li key={r.roomId} className="flex items-start justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p dir="auto" className="font-medium">{r.school ? `${r.school} · ${r.name}` : r.name}</p>
                    {r.teacherName && <p dir="auto" className="text-xs text-zinc-500">{r.teacherName}</p>}
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${n ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200" : "text-zinc-500"}`}>
                    {n ? fmt(t.dash.roomNew, { n }) : t.dash.roomQuiet}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {hasAny && <AskBox childrenList={family.children} />}
    </main>
  );
}

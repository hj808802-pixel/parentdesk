"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useFamily } from "@/lib/family-context";
import { useI18n } from "@/lib/i18n/context";
import { localePath } from "@/lib/i18n/locales";
import { BUCKET_ORDER, bucketOf, daysBetween, todayIn, type Bucket } from "@/lib/dates";
import type { Item } from "@/lib/store";
import { BTN_PRIMARY, BTN_SECONDARY, CARD } from "@/lib/ui";
import AskBox from "./AskBox";
import ItemCard from "./ItemCard";
import Landing from "./Landing";

function byDate(a: Item, b: Item): number {
  if (!a.date && !b.date) return a.createdAt < b.createdAt ? 1 : -1;
  if (!a.date) return 1;
  if (!b.date) return -1;
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return (a.time ?? "99") < (b.time ?? "99") ? -1 : 1;
}

export default function HomeView() {
  const { locale, t } = useI18n();
  const { family, loading, patchItem, removeItem } = useFamily();
  const [showDone, setShowDone] = useState(false);

  const todayIso = todayIn(family?.settings.timezone ?? "UTC");

  const groups = useMemo(() => {
    const out = new Map<Bucket, Item[]>();
    if (!family) return out;
    const items = family.items.filter((it) => (showDone ? true : it.status === "open")).sort(byDate);
    for (const it of items) {
      const b = bucketOf(it.date, todayIso, family.settings.weekStart);
      if (b === "later" && it.date && daysBetween(todayIso, it.date) > 60 && !showDone) continue;
      out.set(b, [...(out.get(b) ?? []), it]);
    }
    return out;
  }, [family, showDone, todayIso]);

  if (loading) return <p className="p-8 text-center text-sm text-zinc-500">{t.common.loading}</p>;
  if (!family) return <Landing />;

  const needsAction = family.items
    .filter((it) => it.status === "open" && it.requires_action && (!it.date || daysBetween(todayIso, it.date) <= 14))
    .sort(byDate)
    .slice(0, 8);
  const hasAny = family.items.length > 0;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t.home.title}</h1>
        <Link href={localePath(locale, "/add")} className={BTN_PRIMARY}>
          + {t.nav.add}
        </Link>
      </div>

      {!hasAny && (
        <div className="mt-6">
          <div className={`${CARD} text-center`}>
            <p className="font-medium">{t.home.empty}</p>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{t.home.emptyHint}</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Link href={localePath(locale, "/add")} className={BTN_PRIMARY}>
                {t.landing.ctaAdd}
              </Link>
              <Link href={localePath(locale, "/add?sample=1")} className={BTN_SECONDARY}>
                {t.landing.ctaSample}
              </Link>
            </div>
          </div>
          <Landing compact />
        </div>
      )}

      {hasAny && needsAction.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-300">{t.home.needsAction}</h2>
          <div className="mt-2 grid gap-3">
            {needsAction.map((it) => (
              <ItemCard key={it.id} item={it} childrenList={family.children} timezone={family.settings.timezone} onPatch={patchItem} onRemove={removeItem} />
            ))}
          </div>
        </section>
      )}

      {hasAny &&
        BUCKET_ORDER.map((b) => {
          const items = (groups.get(b) ?? []).filter((it) => !needsAction.some((n) => n.id === it.id));
          if (items.length === 0) return null;
          return (
            <section key={b} className="mt-6">
              <h2 className={`text-sm font-semibold uppercase tracking-wide ${b === "overdue" ? "text-red-600 dark:text-red-400" : "text-zinc-500"}`}>{t.home.buckets[b]}</h2>
              <div className="mt-2 grid gap-3">
                {items.map((it) => (
                  <ItemCard key={it.id} item={it} childrenList={family.children} timezone={family.settings.timezone} onPatch={patchItem} onRemove={removeItem} />
                ))}
              </div>
            </section>
          );
        })}

      {hasAny && groups.size === 0 && needsAction.length === 0 && <p className="mt-8 text-center text-sm text-zinc-500">{t.home.allDone}</p>}

      {hasAny && <AskBox childrenList={family.children} />}

      {hasAny && (
        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 text-sm">
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
            {t.home.showDone}
          </label>
          <Link href={localePath(locale, "/items")} className="underline underline-offset-4">
            {t.home.viewAll}
          </Link>
        </div>
      )}

      {hasAny && (
        <aside className={`${CARD} mt-8 border-indigo-200 bg-indigo-50 dark:border-indigo-900 dark:bg-indigo-950/40`}>
          <p className="font-semibold">{t.home.subscribeTitle}</p>
          <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">{t.home.subscribeBody}</p>
          <Link href={localePath(locale, "/settings#calendar")} className={`${BTN_SECONDARY} mt-3`}>
            {t.home.subscribeCta}
          </Link>
        </aside>
      )}
    </main>
  );
}

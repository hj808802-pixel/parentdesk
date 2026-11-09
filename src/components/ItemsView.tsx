"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useFamily } from "@/lib/family-context";
import { useI18n } from "@/lib/i18n/context";
import { localePath } from "@/lib/i18n/locales";
import { fmt } from "@/lib/i18n";
import { ITEM_TYPES } from "@/lib/schema";
import type { Item } from "@/lib/store";
import { BTN_PRIMARY, INPUT } from "@/lib/ui";
import ItemCard from "./ItemCard";
import Landing from "./Landing";

export default function ItemsView() {
  const { locale, t } = useI18n();
  const { family, loading, patchItem, removeItem } = useFamily();
  const [status, setStatus] = useState<"open" | "done" | "dismissed" | "all">("open");
  const [child, setChild] = useState("");
  const [type, setType] = useState("");

  const items = useMemo(() => {
    if (!family) return [] as Item[];
    return family.items
      .filter((it) => (status === "all" ? true : it.status === status))
      .filter((it) => (child ? it.childIds.includes(child) : true))
      .filter((it) => (type ? it.type === type : true))
      .sort((a, b) => {
        if (!a.date && !b.date) return a.createdAt < b.createdAt ? 1 : -1;
        if (!a.date) return 1;
        if (!b.date) return -1;
        return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
      });
  }, [family, status, child, type]);

  if (loading) return <p className="p-8 text-center text-sm text-zinc-500">{t.common.loading}</p>;
  if (!family) return <Landing compact />;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t.items.title}</h1>
        <Link href={localePath(locale, "/add")} className={BTN_PRIMARY}>
          + {t.nav.add}
        </Link>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {(["open", "done", "dismissed", "all"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={`rounded-full px-3 py-1 text-sm ${status === s ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "border border-zinc-300 dark:border-zinc-700"}`}
          >
            {s === "open" ? t.items.filterOpen : s === "done" ? t.items.filterDone : s === "dismissed" ? t.items.filterDismissed : t.items.filterAll}
          </button>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="grid gap-1 text-xs text-zinc-500">
          {t.items.byChild}
          <select className={INPUT} value={child} onChange={(e) => setChild(e.target.value)}>
            <option value="">{t.items.allChildren}</option>
            {family.children.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-zinc-500">
          {t.items.byType}
          <select className={INPUT} value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">{t.items.allTypes}</option>
            {ITEM_TYPES.map((ty) => (
              <option key={ty} value={ty}>
                {t.item.types[ty]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="mt-4 text-xs text-zinc-500">{fmt(t.items.count, { n: items.length })}</p>
      {items.length === 0 ? (
        <p className="mt-6 text-center text-sm text-zinc-500">{t.items.empty}</p>
      ) : (
        <div className="mt-2 grid gap-3">
          {items.map((it) => (
            <ItemCard key={it.id} item={it} childrenList={family.children} timezone={family.settings.timezone} members={family.settings.members} onPatch={patchItem} onRemove={removeItem} />
          ))}
        </div>
      )}
    </main>
  );
}

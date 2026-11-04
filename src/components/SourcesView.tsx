"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/client";
import { useFamily } from "@/lib/family-context";
import { useI18n } from "@/lib/i18n/context";
import { LOCALE_TAGS, localePath } from "@/lib/i18n/locales";
import { fmt } from "@/lib/i18n";
import { formatDate } from "@/lib/dates";
import { BTN_PRIMARY, BTN_SMALL, CARD } from "@/lib/ui";
import Landing from "./Landing";

export default function SourcesView() {
  const { locale, t } = useI18n();
  const { family, loading, setFamily } = useFamily();
  const [busy, setBusy] = useState<string | null>(null);

  if (loading) return <p className="p-8 text-center text-sm text-zinc-500">{t.common.loading}</p>;
  if (!family) return <Landing compact />;

  const sources = [...family.sources].sort((a, b) => (a.ts < b.ts ? 1 : -1));

  async function remove(id: string) {
    if (!window.confirm(t.sources.confirmDelete)) return;
    setBusy(id);
    try {
      const res = await api.deleteSource(id);
      setFamily(res.family);
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t.sources.title}</h1>
        <Link href={localePath(locale, "/add")} className={BTN_PRIMARY}>
          + {t.nav.add}
        </Link>
      </div>
      {sources.length === 0 ? (
        <p className="mt-6 text-center text-sm text-zinc-500">{t.sources.empty}</p>
      ) : (
        <div className="mt-4 grid gap-3">
          {sources.map((s) => {
            const count = family.items.filter((it) => it.sourceId === s.id).length;
            return (
              <article key={s.id} className={CARD}>
                <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-medium dark:bg-zinc-800">{t.sources.kinds[s.kind]}</span>
                  <span>{formatDate(s.ts.slice(0, 10), LOCALE_TAGS[locale], { year: "numeric", month: "short", day: "numeric" })}</span>
                  <span>· {fmt(t.sources.itemCount, { n: count })}</span>
                </div>
                <h2 className="mt-1 font-semibold">{s.title}</h2>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">{s.sender}</p>
                <p className="mt-2 text-sm">{s.summary}</p>
                {s.questions.length > 0 && (
                  <>
                    <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">{t.sources.questions}</p>
                    <ul className="mt-1 list-disc pl-5 text-sm">
                      {s.questions.map((q, i) => (
                        <li key={i}>{q}</li>
                      ))}
                    </ul>
                  </>
                )}
                <div className="mt-3">
                  <button type="button" disabled={busy === s.id} className={`${BTN_SMALL} text-red-600 dark:text-red-400`} onClick={() => remove(s.id)}>
                    {t.sources.delete}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}

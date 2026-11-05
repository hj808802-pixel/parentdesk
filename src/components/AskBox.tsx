"use client";

import { useState } from "react";
import { api, ApiFailure } from "@/lib/client";
import { useI18n } from "@/lib/i18n/context";
import { LOCALE_TAGS } from "@/lib/i18n/locales";
import { fmt } from "@/lib/i18n";
import { formatDate } from "@/lib/dates";
import type { Child, Item } from "@/lib/store";
import { BTN_PRIMARY, CARD, INPUT, TYPE_STYLES } from "@/lib/ui";

// "What do we need to pay this month?" answered from the saved list. Stateless: one
// question, one answer, nothing kept.

export default function AskBox({ childrenList }: { childrenList: Child[] }) {
  const { locale, t } = useI18n();
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<{ text: string; items: Item[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function ask(q: string) {
    const text = q.trim();
    if (text.length < 2 || busy) return;
    setBusy(true);
    setError(null);
    setAnswer(null);
    try {
      const res = await api.ask(text);
      setAnswer({ text: res.answer, items: res.items });
    } catch (e) {
      const code = e instanceof ApiFailure ? e.code : "generic";
      const dict = t.add.errors as Record<string, string>;
      setError(code in dict && code !== "generic" ? dict[code] : t.ask.error);
    } finally {
      setBusy(false);
    }
  }

  const suggestions = t.ask.suggestions.map((s) => fmt(s, { child: childrenList[0]?.name ?? "" }));

  return (
    <section className={`${CARD} mt-6`}>
      <h2 className="font-semibold">{t.ask.title}</h2>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
      >
        <input className={INPUT} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={t.ask.placeholder} maxLength={500} aria-label={t.ask.title} />
        <button type="submit" className={BTN_PRIMARY} disabled={busy || question.trim().length < 2}>
          {busy ? t.ask.working : t.ask.submit}
        </button>
      </form>
      <div className="mt-2 flex flex-wrap gap-2">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            disabled={busy}
            className="rounded-full border border-zinc-300 px-3 py-1 text-xs hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            onClick={() => {
              setQuestion(s);
              void ask(s);
            }}
          >
            {s}
          </button>
        ))}
      </div>
      {busy && (
        <p className="mt-3 text-sm text-zinc-500" aria-live="polite">
          {t.ask.working}
        </p>
      )}
      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {answer && (
        <div className="mt-3" aria-live="polite">
          <p dir="auto" className="whitespace-pre-wrap text-sm">{answer.text}</p>
          {answer.items.length > 0 && (
            <>
              <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">{t.ask.related}</p>
              <ul className="mt-1 grid gap-1 text-sm">
                {answer.items.map((it) => (
                  <li key={it.id} className="flex items-center gap-2">
                    <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${TYPE_STYLES[it.type].dot}`} aria-hidden />
                    <span className={it.status !== "open" ? "line-through opacity-60" : ""}>{it.title}</span>
                    {it.date && <span className="text-xs text-zinc-500">{formatDate(it.date, LOCALE_TAGS[locale])}</span>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      <p className="mt-3 text-xs text-zinc-500">{t.ask.hint}</p>
    </section>
  );
}

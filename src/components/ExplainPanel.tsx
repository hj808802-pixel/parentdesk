"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiFailure } from "@/lib/client";
import { useI18n } from "@/lib/i18n/context";
import { BTN_SMALL } from "@/lib/ui";

// One item in plain words, for a parent who is new to this school system or reads the
// school's language with effort. Fetched once when the panel opens; nothing is stored.

type Explanation = { explanation: string; what_to_do: string[]; context: string | null; ask_school: string | null };

export default function ExplainPanel({ itemId, onClose }: { itemId: string; onClose: () => void }) {
  const { t } = useI18n();
  const [result, setResult] = useState<Explanation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    api
      .explain(itemId)
      .then((res) => setResult({ explanation: res.explanation, what_to_do: res.what_to_do, context: res.context, ask_school: res.ask_school }))
      .catch((e: unknown) => {
        const code = e instanceof ApiFailure ? e.code : "generic";
        const dict = t.add.errors as Record<string, string>;
        setError(code in dict && code !== "generic" ? dict[code] : t.explain.error);
      });
  }, [itemId, t]);

  return (
    <div className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50/60 p-3 text-sm dark:border-indigo-900 dark:bg-indigo-950/30" aria-live="polite">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold">{t.explain.title}</p>
        <button type="button" className={BTN_SMALL} onClick={onClose}>
          {t.common.close}
        </button>
      </div>
      {!result && !error && <p className="mt-2 text-zinc-600 dark:text-zinc-400">{t.explain.working}</p>}
      {error && <p className="mt-2 text-red-600 dark:text-red-400">{error}</p>}
      {result && (
        <>
          <p dir="auto" className="mt-2 leading-relaxed">{result.explanation}</p>
          {result.what_to_do.length > 0 && (
            <>
              <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">{t.explain.steps}</p>
              <ol className="mt-1 list-decimal pl-5">
                {result.what_to_do.map((s, i) => (
                  <li key={i} dir="auto">{s}</li>
                ))}
              </ol>
            </>
          )}
          {result.context && (
            <>
              <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">{t.explain.context}</p>
              <p dir="auto" className="mt-1">{result.context}</p>
            </>
          )}
          {result.ask_school && (
            <>
              <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">{t.explain.ask}</p>
              <p dir="auto" className="mt-1">{result.ask_school}</p>
            </>
          )}
          <p className="mt-3 text-xs text-zinc-500">{t.explain.disclaimer}</p>
        </>
      )}
    </div>
  );
}

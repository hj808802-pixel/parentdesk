"use client";

import { useI18n } from "@/lib/i18n/context";
import { BTN_PRIMARY, BTN_SECONDARY } from "@/lib/ui";

// Shown when a client error escapes a page. `reset` re-renders the segment.
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useI18n();
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-16 text-center">
      <h1 className="text-xl font-bold">{t.error.title}</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{t.error.body}</p>
      <div className="mt-6 flex justify-center gap-2">
        <button type="button" onClick={() => reset()} className={BTN_PRIMARY}>
          {t.error.retry}
        </button>
        <button type="button" onClick={() => window.location.reload()} className={BTN_SECONDARY}>
          {t.error.reload}
        </button>
      </div>
      {error.digest && <p className="mt-4 text-xs text-zinc-400">Error {error.digest}</p>}
    </main>
  );
}

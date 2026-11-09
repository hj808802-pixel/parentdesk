"use client";

import { useEffect, useState } from "react";
import { ApiFailure } from "@/lib/client";
import { useI18n } from "@/lib/i18n/context";

// The safety net for every button: a request that fails inside a click handler without
// its own error state ends up here as an unhandled rejection, and the parent sees a short
// message instead of nothing happening.

export default function ErrorToast() {
  const { t } = useI18n();
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onReject = (e: PromiseRejectionEvent) => {
      const dict = t.add.errors as Record<string, string>;
      let text = t.add.errors.generic;
      if (e.reason instanceof ApiFailure) {
        if (e.reason.code === "no_family") text = t.settings.noFamily;
        else if (e.reason.code in dict && !dict[e.reason.code].includes("{")) text = dict[e.reason.code];
      }
      e.preventDefault();
      setMsg(text);
      clearTimeout(timer);
      timer = setTimeout(() => setMsg(null), 7000);
    };
    window.addEventListener("unhandledrejection", onReject);
    return () => {
      window.removeEventListener("unhandledrejection", onReject);
      clearTimeout(timer);
    };
  }, [t]);

  if (!msg) return null;
  return (
    <div role="alert" className="fixed inset-x-4 bottom-20 z-30 flex items-start gap-3 rounded-xl bg-zinc-900 px-4 py-3 text-sm text-white shadow-lg sm:inset-x-auto sm:right-6 sm:bottom-6 sm:max-w-sm dark:bg-zinc-100 dark:text-zinc-900">
      <span className="flex-1">{msg}</span>
      <button type="button" className="shrink-0 opacity-70 hover:opacity-100" aria-label={t.common.close} onClick={() => setMsg(null)}>
        ✕
      </button>
    </div>
  );
}

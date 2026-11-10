"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/context";

// A notice from the operator ("maintenance on Sunday", "new: class search"), shown once
// per announcement until it is closed on this device.

export default function Announcement({ audience }: { audience: "teachers" | "families" }) {
  const { locale, t } = useI18n();
  const [a, setA] = useState<{ id: string; text: string } | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/announcement?for=${audience}&locale=${locale}`)
      .then((r) => r.json())
      .then((body: { announcement?: { id: string; text: string } | null }) => {
        const got = body.announcement;
        if (!live || !got) return;
        try {
          if (window.localStorage.getItem("pd_announcement_closed") === got.id) return;
        } catch {
          /* storage unavailable: show it */
        }
        setA(got);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [audience, locale]);

  if (!a) return null;
  return (
    <aside className="mt-3 flex items-start gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm dark:border-indigo-900 dark:bg-indigo-950/40" role="status">
      <p dir="auto" className="min-w-0 flex-1 whitespace-pre-wrap">{a.text}</p>
      <button
        type="button"
        className="shrink-0 opacity-70 hover:opacity-100"
        aria-label={t.common.close}
        onClick={() => {
          try {
            window.localStorage.setItem("pd_announcement_closed", a.id);
          } catch {
            /* storage unavailable */
          }
          setA(null);
        }}
      >
        ✕
      </button>
    </aside>
  );
}

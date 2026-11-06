"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, rememberKey } from "@/lib/client";
import { useFamily } from "@/lib/family-context";
import { useI18n } from "@/lib/i18n/context";
import { localePath } from "@/lib/i18n/locales";
import { BTN_PRIMARY, BTN_SECONDARY, CARD } from "@/lib/ui";

// /join?i=<family id>.<secret>: the page an invite link opens. One request, then a
// link into the family's week.

export default function JoinView() {
  const { locale, t } = useI18n();
  const { setFamily } = useFamily();
  const params = useSearchParams();
  const [state, setState] = useState<"working" | "done" | "invalid">("working");
  const started = useRef(false);

  const token = params.get("i");
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!token) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reading the URL once
      setState("invalid");
      return;
    }
    api
      .joinInvite(token)
      .then((res) => {
        rememberKey(res.key);
        setFamily(res.family);
        setState("done");
        window.history.replaceState(null, "", window.location.pathname);
      })
      .catch(() => setState("invalid"));
  }, [token, setFamily]);

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-12">
      <section className={`${CARD} text-center`}>
        <h1 className="text-xl font-bold">{t.join.title}</h1>
        {state === "working" && <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">{t.join.working}</p>}
        {state === "done" && (
          <>
            <p className="mt-3 text-sm">{t.join.done}</p>
            <Link href={localePath(locale, "/")} className={`${BTN_PRIMARY} mt-5`}>
              {t.join.goWeek}
            </Link>
          </>
        )}
        {state === "invalid" && (
          <>
            <p className="mt-3 text-sm text-zinc-700 dark:text-zinc-300">{t.join.invalid}</p>
            <Link href={localePath(locale, "/settings")} className={`${BTN_SECONDARY} mt-5`}>
              {t.join.openSettings}
            </Link>
          </>
        )}
      </section>
    </main>
  );
}

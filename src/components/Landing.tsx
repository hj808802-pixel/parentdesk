"use client";

import Link from "next/link";
import Image from "next/image";
import { useI18n } from "@/lib/i18n/context";
import { localePath } from "@/lib/i18n/locales";
import { fmt } from "@/lib/i18n";
import { BTN_PRIMARY, BTN_SECONDARY, CARD } from "@/lib/ui";

export default function Landing({ compact = false }: { compact?: boolean }) {
  const { locale, t } = useI18n();
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <section className="text-center">
        <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-300">{t.landing.eyebrow}</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">{t.landing.h1}</h1>
        <p className="mx-auto mt-4 max-w-2xl text-base text-zinc-600 dark:text-zinc-400">{t.landing.lead}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href={localePath(locale, "/add")} className={BTN_PRIMARY}>
            {t.landing.ctaAdd}
          </Link>
          <Link href={localePath(locale, "/add?sample=1")} className={BTN_SECONDARY}>
            {t.landing.ctaSample}
          </Link>
        </div>
      </section>

      {!compact && (
        <>
          <section className="mt-12">
            <h2 className="text-lg font-semibold">{t.landing.howTitle}</h2>
            <ol className="mt-4 grid gap-3 sm:grid-cols-3">
              {t.landing.steps.map((s, i) => (
                <li key={i} className={CARD}>
                  <p className="text-xs font-semibold text-indigo-600 dark:text-indigo-300">{fmt(t.landing.step, { n: i + 1 })}</p>
                  <p className="mt-1 font-semibold">{s.t}</p>
                  <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{s.d}</p>
                </li>
              ))}
            </ol>
          </section>

          <section className={`${CARD} mt-6 border-indigo-200 bg-indigo-50 dark:border-indigo-900 dark:bg-indigo-950/40`}>
            <p className="font-semibold">{t.landing.autoTitle}</p>
            <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">{t.landing.autoBody}</p>
          </section>

          <section className={`${CARD} mt-4 border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40`}>
            <p className="font-semibold">{t.landing.teachTitle}</p>
            <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">{t.landing.teachBody}</p>
            <Link href={localePath(locale, "/teach")} className={`${BTN_SECONDARY} mt-3`}>
              {t.landing.teachCta}
            </Link>
          </section>

          <section className="mt-12 grid gap-6 sm:grid-cols-2">
            <div>
              <h2 className="text-lg font-semibold">{t.landing.promiseTitle}</h2>
              <ul className="mt-3 space-y-2 text-sm text-zinc-700 dark:text-zinc-300">
                {t.landing.promises.map((p, i) => (
                  <li key={i} className="flex gap-2">
                    <span aria-hidden>✓</span>
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
              <h2 className="mt-8 text-lg font-semibold">{t.landing.countriesTitle}</h2>
              <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">{t.landing.countriesBody}</p>
            </div>
            <figure className={CARD}>
              <Image src="/sample-notice.png" alt={t.landing.sampleCaption} width={900} height={1100} className="h-auto w-full rounded-lg border dark:border-zinc-800" />
              <figcaption className="mt-2 text-center text-xs text-zinc-500">{t.landing.sampleCaption}</figcaption>
            </figure>
          </section>
        </>
      )}
    </div>
  );
}

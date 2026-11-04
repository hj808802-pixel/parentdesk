"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import { localePath } from "@/lib/i18n/locales";
import { BTN_PRIMARY } from "@/lib/ui";

export default function NotFound() {
  const { locale, t } = useI18n();
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-16 text-center">
      <h1 className="text-xl font-bold">{t.notFound.title}</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{t.notFound.body}</p>
      <Link href={localePath(locale, "/")} className={`${BTN_PRIMARY} mt-6`}>
        {t.notFound.home}
      </Link>
    </main>
  );
}

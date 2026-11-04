"use client";

import { usePathname } from "next/navigation";
import { LOCALES, LOCALE_COOKIE, LOCALE_NAMES, localePath, splitLocale, type Locale } from "@/lib/i18n/locales";
import { useI18n } from "@/lib/i18n/context";

// Changes the UI language: remembers the choice in a cookie (so the proxy stops guessing
// from Accept-Language) and loads the same page under the new prefix.
export default function LanguageSwitcher({ className = "" }: { className?: string }) {
  const { locale, t } = useI18n();
  const pathname = usePathname();

  function change(next: Locale) {
    document.cookie = `${LOCALE_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    const { path } = splitLocale(pathname || "/");
    window.location.assign(localePath(next, path));
  }

  return (
    <label className={`inline-flex items-center gap-1 text-xs ${className}`}>
      <span className="sr-only">{t.nav.language}</span>
      <select
        aria-label={t.nav.language}
        value={locale}
        onChange={(e) => change(e.target.value as Locale)}
        translate="no"
        className="rounded-md border bg-white px-1.5 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
      >
        {LOCALES.map((l) => (
          <option key={l} value={l} lang={l}>
            {LOCALE_NAMES[l]}
          </option>
        ))}
      </select>
    </label>
  );
}

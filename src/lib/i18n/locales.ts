// UI locales. English lives at the bare path (/items); the others under a prefix
// (/ja/items). The language the extractor writes results in is a separate, longer list
// (schema.ts OUTPUT_LANGUAGES) chosen per family in Settings.

export const LOCALES = ["en", "ko", "es", "ja", "zh", "fr", "de", "pt", "it", "vi"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  ko: "한국어",
  es: "Español",
  ja: "日本語",
  zh: "中文",
  fr: "Français",
  de: "Deutsch",
  pt: "Português",
  it: "Italiano",
  vi: "Tiếng Việt",
};

// BCP 47 tags for <html lang> and Intl.
export const LOCALE_TAGS: Record<Locale, string> = {
  en: "en",
  ko: "ko",
  es: "es",
  ja: "ja",
  zh: "zh-Hans",
  fr: "fr",
  de: "de",
  pt: "pt",
  it: "it",
  vi: "vi",
};

export const LOCALE_COOKIE = "pd_locale";

export function isLocale(x: unknown): x is Locale {
  return typeof x === "string" && (LOCALES as readonly string[]).includes(x);
}

export function localePath(locale: Locale, path = "/"): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  if (locale === DEFAULT_LOCALE) return clean;
  return clean === "/" ? `/${locale}` : `/${locale}${clean}`;
}

// "/ja/items" -> { locale: "ja", path: "/items" }
export function splitLocale(pathname: string): { locale: Locale | null; path: string } {
  const m = /^\/([a-zA-Z-]+)(\/.*)?$/.exec(pathname);
  if (m && isLocale(m[1])) return { locale: m[1], path: m[2] || "/" };
  return { locale: null, path: pathname || "/" };
}

// A country's name in the UI language, from the browser's own data (Intl.DisplayNames).
export function regionName(code: string, tag: string, fallback: string): string {
  try {
    return new Intl.DisplayNames([tag], { type: "region" }).of(code) ?? fallback;
  } catch {
    return fallback;
  }
}

// Picks a UI locale from an Accept-Language header; anything outside the list is English.
export function pickLocale(acceptLanguage: string | null | undefined): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE;
  const ranked = acceptLanguage
    .split(",")
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      return { tag: tag.toLowerCase(), q: q ? Number(q.slice(2)) : 1, i };
    })
    .filter((r) => r.tag && !Number.isNaN(r.q) && r.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  for (const r of ranked) {
    const base = r.tag.split("-")[0];
    if (base === "en") return "en";
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

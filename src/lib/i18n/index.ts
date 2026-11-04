import { en, type Dict } from "./en";
import { ko } from "./ko";
import { es } from "./es";
import { ja } from "./ja";
import { zh } from "./zh";
import { fr } from "./fr";
import { de } from "./de";
import { DEFAULT_LOCALE, isLocale, type Locale } from "./locales";

export type { Dict } from "./en";
export * from "./locales";

const DICTS: Record<Locale, Dict> = { en, ko, es, ja, zh, fr, de };

export function getDict(locale: string | undefined | null): Dict {
  return DICTS[isLocale(locale) ? locale : DEFAULT_LOCALE];
}

// "{n} items" + { n: 3 } -> "3 items"
export function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

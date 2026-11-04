"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Dict } from "./en";
import type { Locale } from "./locales";

// Client components read the current UI locale and its dictionary from here. The
// [locale] layout (a server component) picks the dictionary and passes it down once.

type I18n = { locale: Locale; t: Dict };

const Ctx = createContext<I18n | null>(null);

export function LocaleProvider({ locale, dict, children }: { locale: Locale; dict: Dict; children: ReactNode }) {
  return <Ctx.Provider value={{ locale, t: dict }}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error("useI18n must be used inside LocaleProvider");
  return v;
}

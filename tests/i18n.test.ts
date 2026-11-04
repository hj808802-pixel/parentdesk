import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/en";
import { ko } from "@/lib/i18n/ko";
import { es } from "@/lib/i18n/es";
import { ja } from "@/lib/i18n/ja";
import { zh } from "@/lib/i18n/zh";
import { fr } from "@/lib/i18n/fr";
import { de } from "@/lib/i18n/de";
import { fmt, getDict, pickLocale, splitLocale, localePath } from "@/lib/i18n";

function keys(obj: unknown, prefix = ""): string[] {
  if (Array.isArray(obj)) return obj.flatMap((v, i) => keys(v, `${prefix}[${i}]`));
  if (obj && typeof obj === "object") return Object.entries(obj).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
  return [prefix];
}

describe("i18n", () => {
  it("every dictionary has exactly the English keys", () => {
    const ref = keys(en).sort();
    for (const [name, dict] of Object.entries({ ko, es, ja, zh, fr, de })) {
      expect(keys(dict).sort(), name).toEqual(ref);
    }
  });

  it("keeps placeholders in every language", () => {
    const check = (a: string, b: string) => expect((b.match(/\{\w+\}/g) ?? []).sort()).toEqual((a.match(/\{\w+\}/g) ?? []).sort());
    for (const dict of [ko, es, ja, zh, fr, de]) {
      check(en.home.inDays, dict.home.inDays);
      check(en.add.errors.too_large, dict.add.errors.too_large);
      check(en.items.count, dict.items.count);
      check(en.settings.usage, dict.settings.usage);
      check(en.legal.updated, dict.legal.updated);
    }
  });

  it("formats placeholders and routes locales", () => {
    expect(fmt("{n} items", { n: 3 })).toBe("3 items");
    expect(getDict("xx").nav.brand).toBe("ParentDesk");
    expect(getDict("ja").nav.week).toBe(ja.nav.week);
    expect(splitLocale("/ja/items")).toEqual({ locale: "ja", path: "/items" });
    expect(splitLocale("/items")).toEqual({ locale: null, path: "/items" });
    expect(localePath("en", "/add")).toBe("/add");
    expect(localePath("de", "/")).toBe("/de");
    expect(pickLocale("fr-CA,fr;q=0.9,en;q=0.8")).toBe("fr");
    expect(pickLocale("pt-BR,pt;q=0.9")).toBe("en");
    expect(pickLocale(null)).toBe("en");
  });
});

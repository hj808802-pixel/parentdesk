import type { MetadataRoute } from "next";
import { LOCALES, LOCALE_TAGS, localePath } from "@/lib/i18n/locales";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://parentdesk-app.vercel.app";
const PAGES = ["/", "/add", "/pricing", "/privacy", "/terms"];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return PAGES.flatMap((page) =>
    LOCALES.map((locale) => ({
      url: `${SITE_URL}${localePath(locale, page)}`,
      lastModified: now,
      changeFrequency: page === "/" ? ("weekly" as const) : ("monthly" as const),
      priority: page === "/" ? 1 : 0.6,
      alternates: {
        languages: Object.fromEntries(LOCALES.map((l) => [LOCALE_TAGS[l], `${SITE_URL}${localePath(l, page)}`])),
      },
    })),
  );
}

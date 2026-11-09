import { redirect } from "next/navigation";
import { DEFAULT_LOCALE, isLocale, localePath } from "@/lib/i18n/locales";

// The flat item list merged into the schedule (filters live there now); old links follow.
export default async function ItemsPage({ params }: { params: Promise<{ locale: string }> }) {
  const raw = (await params).locale;
  redirect(localePath(isLocale(raw) ? raw : DEFAULT_LOCALE, "/week"));
}

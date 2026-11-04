"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { localePath, splitLocale } from "@/lib/i18n/locales";

// The five sections. On phones this renders as a bottom bar, on wider screens inline.
export default function NavLinks({ className = "", mobile = false }: { className?: string; mobile?: boolean }) {
  const { locale, t } = useI18n();
  const pathname = usePathname() || "/";
  const { path } = splitLocale(pathname);
  const links = [
    { href: "/", label: t.nav.week, icon: "▣" },
    { href: "/add", label: t.nav.add, icon: "＋" },
    { href: "/items", label: t.nav.items, icon: "☰" },
    { href: "/sources", label: t.nav.sources, icon: "✉" },
    { href: "/settings", label: t.nav.settings, icon: "⚙" },
  ];
  return (
    <nav aria-label="Site" className={`${mobile ? "" : "gap-4"} text-xs ${className}`}>
      {links.map((l) => {
        const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={localePath(locale, l.href)}
            aria-current={active ? "page" : undefined}
            className={
              mobile
                ? `flex flex-col items-center gap-0.5 rounded-lg px-3 py-1 ${active ? "text-indigo-600 dark:text-indigo-300" : "text-zinc-600 dark:text-zinc-400"}`
                : `${active ? "font-semibold text-zinc-900 dark:text-white" : "text-zinc-600 dark:text-zinc-400"}`
            }
          >
            {mobile && (
              <span aria-hidden className="text-base leading-none">
                {l.icon}
              </span>
            )}
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}

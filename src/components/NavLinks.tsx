"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { localePath, splitLocale } from "@/lib/i18n/locales";

// The five sections (all items is reached from home and the week). On phones this renders
// as a bottom bar, on wider screens inline.
export default function NavLinks({ className = "", mobile = false }: { className?: string; mobile?: boolean }) {
  const { locale, t } = useI18n();
  const pathname = usePathname() || "/";
  const { path } = splitLocale(pathname);
  const links = [
    { href: "/", label: t.nav.home, icon: "⌂" },
    { href: "/week", label: t.nav.week, icon: "▣" },
    { href: "/add", label: t.nav.add, icon: "＋" },
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
                ? `flex min-w-0 flex-1 basis-0 flex-col items-center gap-0.5 rounded-lg px-1 py-1 ${active ? "text-indigo-600 dark:text-indigo-300" : "text-zinc-600 dark:text-zinc-400"}`
                : `${active ? "font-semibold text-zinc-900 dark:text-white" : "text-zinc-600 dark:text-zinc-400"}`
            }
          >
            {mobile && (
              <span aria-hidden className="text-base leading-none">
                {l.icon}
              </span>
            )}
            {mobile ? <span className="line-clamp-2 max-w-full break-words text-center text-[11px] leading-tight">{l.label}</span> : l.label}
          </Link>
        );
      })}
    </nav>
  );
}

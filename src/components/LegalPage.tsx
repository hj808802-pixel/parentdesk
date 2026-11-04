"use client";

import { useI18n } from "@/lib/i18n/context";
import { fmt } from "@/lib/i18n";

const UPDATED = "2026-11-05";

export default function LegalPage({ kind }: { kind: "privacy" | "terms" }) {
  const { t } = useI18n();
  const paragraphs = kind === "privacy" ? t.legal.privacy : t.legal.terms;
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold">{kind === "privacy" ? t.legal.privacyTitle : t.legal.termsTitle}</h1>
      <p className="mt-1 text-xs text-zinc-500">{fmt(t.legal.updated, { date: UPDATED })}</p>
      <div className="mt-6 space-y-4 text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">
        {paragraphs.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
    </main>
  );
}

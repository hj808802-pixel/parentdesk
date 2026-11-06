"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { useFamily } from "@/lib/family-context";
import { useI18n } from "@/lib/i18n/context";
import { fmt } from "@/lib/i18n";
import { localePath } from "@/lib/i18n/locales";
import type { PlanLimits } from "@/lib/types";
import { BTN_PRIMARY, BTN_SECONDARY, CARD } from "@/lib/ui";

const FALLBACK: PlanLimits = { freeNotices: 15, freeChildren: 1, priceMonthly: "$4.99", priceYearly: "$39" };

export default function PricingView() {
  const { locale, t } = useI18n();
  const { family, loading } = useFamily();
  const [server, setServer] = useState<{ billing: boolean; limits: PlanLimits } | null>(null);
  const [busy, setBusy] = useState<"" | "month" | "year" | "portal">("");
  const [error, setError] = useState(false);

  // Without a family the numbers come from the server's public health endpoint.
  useEffect(() => {
    if (family) return;
    api
      .health()
      .then((h) => setServer({ billing: h.billing, limits: h.limits }))
      .catch(() => setServer({ billing: false, limits: FALLBACK }));
  }, [family]);

  const limits = family?.limits ?? server?.limits ?? FALLBACK;
  const billingOn = family ? family.features.billing : (server?.billing ?? false);
  const plan = family?.plan ?? null;

  async function go(interval: "month" | "year") {
    setBusy(interval);
    setError(false);
    try {
      const res = await api.checkout(interval);
      window.location.href = res.url;
    } catch {
      setError(true);
      setBusy("");
    }
  }

  async function portal() {
    setBusy("portal");
    setError(false);
    try {
      const res = await api.portal();
      window.location.href = res.url;
    } catch {
      setError(true);
      setBusy("");
    }
  }

  const check = (s: string, i: number) => (
    <li key={i} className="flex gap-2 text-sm">
      <span aria-hidden className="text-emerald-600">
        ✓
      </span>
      <span>{s}</span>
    </li>
  );

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-bold">{t.pricing.title}</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{t.pricing.lead}</p>
      {!billingOn && !loading && <p className="mt-3 rounded-xl bg-indigo-50 px-3 py-2 text-sm text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-200">{t.pricing.betaNote}</p>}

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <section className={CARD}>
          <h2 className="text-lg font-semibold">{t.pricing.free}</h2>
          <p className="mt-1 text-2xl font-bold">0</p>
          <ul className="mt-4 grid gap-2">{t.pricing.freeFeatures.map((s, i) => check(fmt(s, { n: limits.freeNotices, k: limits.freeChildren }), i))}</ul>
          {billingOn && plan === "free" && <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-300">{t.pricing.current}</p>}
        </section>

        <section className={`${CARD} border-indigo-300 dark:border-indigo-800`}>
          <h2 className="text-lg font-semibold">{t.pricing.family}</h2>
          <p className="mt-1 text-2xl font-bold">{fmt(t.pricing.perMonth, { price: limits.priceMonthly })}</p>
          <p className="text-xs text-zinc-500">
            {fmt(t.pricing.perYear, { price: limits.priceYearly })} · {t.pricing.yearlyNote}
          </p>
          <ul className="mt-4 grid gap-2">{t.pricing.familyFeatures.map(check)}</ul>
          {billingOn && plan === "family" && (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-300">{t.pricing.current}</p>
              {family?.billing && (
                <button type="button" className={`${BTN_SECONDARY} mt-2`} disabled={busy !== ""} onClick={portal}>
                  {t.settings.manageBilling}
                </button>
              )}
            </div>
          )}
          {billingOn && plan === "free" && (
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" className={BTN_PRIMARY} disabled={busy !== ""} onClick={() => go("month")}>
                {t.pricing.ctaMonthly}
              </button>
              <button type="button" className={BTN_SECONDARY} disabled={busy !== ""} onClick={() => go("year")}>
                {t.pricing.ctaYearly}
              </button>
            </div>
          )}
          {billingOn && !family && !loading && (
            <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
              {t.pricing.noFamily}{" "}
              <Link href={localePath(locale, "/add")} className="underline underline-offset-4">
                {t.landing.ctaAdd}
              </Link>
            </p>
          )}
          {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{t.settings.billingStatus.error}</p>}
        </section>
      </div>
      <p className="mt-4 text-xs text-zinc-500">{t.pricing.cancelNote}</p>
    </main>
  );
}

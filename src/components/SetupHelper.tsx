"use client";

import { useState } from "react";
import { api, ApiFailure } from "@/lib/client";
import { useFamily } from "@/lib/family-context";
import { useI18n } from "@/lib/i18n/context";
import { fmt } from "@/lib/i18n";
import { LOCALE_TAGS, regionName } from "@/lib/i18n/locales";
import { COUNTRIES } from "@/lib/countries";
import { OUTPUT_LANGUAGES, type SetupSection } from "@/lib/schema";
import { applySuggestion, type Change } from "@/lib/setup";
import { BTN_PRIMARY, BTN_SECONDARY, BTN_SMALL, CARD, INPUT } from "@/lib/ui";

// "Add my second child" in the parent's own words. The assistant proposes, the parent
// sees every change as "field: before → after" and taps Apply; only then is it saved
// through the ordinary settings route.

type Proposal = { reply: string; section: SetupSection | null; settings: ReturnType<typeof applySuggestion>["settings"]; children: ReturnType<typeof applySuggestion>["children"]; changes: Change[] };

export default function SetupHelper({ onGo }: { onGo: (section: SetupSection) => void }) {
  const { locale, t } = useI18n();
  const { family, setFamily } = useFamily();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [applied, setApplied] = useState(false);
  const tag = LOCALE_TAGS[locale];

  async function ask(q: string) {
    const body = q.trim();
    if (!family || body.length < 2 || busy) return;
    setBusy(true);
    setError(null);
    setProposal(null);
    setApplied(false);
    try {
      const res = await api.assistSettings(body, locale);
      const plan = applySuggestion(family.settings, family.children, res);
      setProposal({ reply: res.reply, section: res.section, ...plan });
    } catch (e) {
      const code = e instanceof ApiFailure ? e.code : "generic";
      const dict = t.add.errors as Record<string, string>;
      setError(code in dict && code !== "generic" ? dict[code] : t.settings.setup.aiError);
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!proposal || applying) return;
    setApplying(true);
    try {
      const res = await api.updateFamily({ settings: { ...proposal.settings, locale }, children: proposal.children });
      setFamily(res.family);
      setProposal(null);
      setText("");
      setApplied(true);
    } catch {
      setError(t.settings.setup.aiError);
    } finally {
      setApplying(false);
    }
  }

  // Values shown the way the settings page shows them, not as codes.
  function show(key: Change["key"], v: string): string {
    if (!v) return "—";
    if (key === "country") return regionName(v, tag, COUNTRIES.find((c) => c.code === v)?.name ?? v);
    if (key === "language") return OUTPUT_LANGUAGES.find((l) => l.code === v)?.label ?? v;
    if (key === "weekStart") return v === "0" ? t.settings.sunday : t.settings.monday;
    if (key === "dateOrder") return (t.settings.dateOrders as Record<string, string>)[v] ?? v;
    if (key === "digest") return v === "on" ? t.settings.setup.on : t.settings.setup.off;
    return v;
  }

  return (
    <section className={`${CARD} mt-4`}>
      <h2 className="font-semibold">✨ {t.settings.setup.aiTitle}</h2>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{t.settings.setup.aiBody}</p>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(text);
        }}
      >
        <input className={`${INPUT} min-w-0`} value={text} onChange={(e) => setText(e.target.value)} placeholder={t.settings.setup.aiPlaceholder} maxLength={600} aria-label={t.settings.setup.aiTitle} />
        <button type="submit" className={`${BTN_PRIMARY} shrink-0 whitespace-nowrap`} disabled={busy || text.trim().length < 2}>
          {busy ? t.settings.setup.aiWorking : t.settings.setup.aiSubmit}
        </button>
      </form>
      <div className="mt-2 flex flex-wrap gap-2">
        {t.settings.setup.aiExamples.map((s) => (
          <button
            key={s}
            type="button"
            disabled={busy}
            className="rounded-full border border-zinc-300 px-3 py-1 text-xs hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            onClick={() => {
              setText(s);
              void ask(s);
            }}
          >
            {s}
          </button>
        ))}
      </div>
      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {applied && (
        <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-300" role="status">
          {t.settings.setup.aiApplied}
        </p>
      )}
      {proposal && (
        <div className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm dark:border-indigo-900 dark:bg-indigo-950/40" aria-live="polite">
          <p dir="auto">{proposal.reply}</p>
          {proposal.changes.length > 0 ? (
            <>
              <ul className="mt-2 grid gap-1">
                {proposal.changes.map((c, i) => (
                  <li key={i} dir="auto" className="flex flex-wrap gap-x-2">
                    <span className="font-medium">{t.settings.setup.fields[c.key]}:</span>
                    {c.from && c.to ? (
                      <span>
                        <span className="text-zinc-500 line-through">{show(c.key, c.from)}</span> → {show(c.key, c.to)}
                      </span>
                    ) : (
                      <span>{show(c.key, c.to || c.from)}</span>
                    )}
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className={BTN_PRIMARY} disabled={applying} onClick={apply}>
                  {t.settings.setup.aiApply}
                </button>
                <button type="button" className={BTN_SECONDARY} disabled={applying} onClick={() => setProposal(null)}>
                  {t.settings.setup.aiCancel}
                </button>
              </div>
            </>
          ) : (
            <p className="mt-1 text-xs text-zinc-500">{proposal.section ? "" : t.settings.setup.aiNoChange}</p>
          )}
          {proposal.section && (
            <button type="button" className={`${BTN_SMALL} mt-2`} onClick={() => onGo(proposal.section as SetupSection)}>
              {fmt(t.settings.setup.aiOpen, { section: t.settings.setup.sections[proposal.section] })}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

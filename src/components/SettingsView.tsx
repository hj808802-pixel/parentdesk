"use client";

import { useEffect, useState } from "react";
import { api, browserTimezone, feedUrl, forgetKey, readKey, rememberKey, writeClipboard } from "@/lib/client";
import { COUNTRIES, TIMEZONES, type DateOrder } from "@/lib/countries";
import { useFamily } from "@/lib/family-context";
import { useI18n } from "@/lib/i18n/context";
import { fmt } from "@/lib/i18n";
import { OUTPUT_LANGUAGES } from "@/lib/schema";
import { CHILD_COLORS, MAX_CHILDREN, type Child, type Settings } from "@/lib/types";
import { BTN_PRIMARY, BTN_SECONDARY, BTN_SMALL, CARD, INPUT } from "@/lib/ui";

export default function SettingsView() {
  const { locale, t } = useI18n();
  const { family, loading, setFamily, refresh } = useFamily();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [children, setChildren] = useState<Child[]>([]);
  const [newChild, setNewChild] = useState("");
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [copied, setCopied] = useState<"" | "feed" | "key" | "inbound">("");
  const [copyFailed, setCopyFailed] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [joinKey, setJoinKey] = useState("");
  const [joinError, setJoinError] = useState(false);
  const [storedKey, setStoredKey] = useState("");

  // The form is a draft of the server document: reload it whenever the document changes.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing a draft from server data
    setStoredKey(readKey());
    if (family) {
      setSettings(family.settings);
      setChildren(family.children);
    }
  }, [family]);

  if (loading) return <p className="p-8 text-center text-sm text-zinc-500">{t.common.loading}</p>;

  async function copy(text: string, what: "feed" | "key" | "inbound") {
    const ok = await writeClipboard(text);
    setCopied(ok ? what : "");
    setCopyFailed(!ok);
    setTimeout(() => {
      setCopied("");
      setCopyFailed(false);
    }, 2500);
  }

  async function create() {
    const res = await api.createFamily({ locale, timezone: browserTimezone() });
    rememberKey(res.key);
    setFamily(res.family);
  }

  async function save() {
    if (!settings) return;
    setSaving(true);
    try {
      const res = await api.updateFamily({ settings, children });
      setFamily(res.family);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 4000);
    } finally {
      setSaving(false);
    }
  }

  async function join() {
    setJoinError(false);
    try {
      const res = await api.joinFamily(joinKey.trim());
      rememberKey(joinKey.trim());
      setFamily(res.family);
      setJoinKey("");
      await refresh();
    } catch {
      setJoinError(true);
    }
  }

  async function leave() {
    await api.leaveFamily();
    forgetKey();
    setFamily(null);
  }

  async function destroy() {
    if (!window.confirm(t.settings.deleteConfirm)) return;
    await api.deleteFamily();
    forgetKey();
    setFamily(null);
  }

  async function rotate() {
    if (!window.confirm(t.settings.rotateConfirm)) return;
    const res = await api.rotateFeed();
    setFamily(res.family);
  }

  const tzList = settings && !TIMEZONES.includes(settings.timezone) ? [settings.timezone, ...TIMEZONES] : TIMEZONES;
  const month = new Date().toISOString().slice(0, 7);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <h1 className="text-2xl font-bold">{t.settings.title}</h1>

      {!family && (
        <section className={`${CARD} mt-4`}>
          <p className="text-sm">{t.settings.noFamily}</p>
          <button type="button" className={`${BTN_PRIMARY} mt-3`} onClick={create}>
            {t.settings.create}
          </button>
        </section>
      )}

      {family && settings && (
        <>
          <section className={`${CARD} mt-4`}>
            <h2 className="font-semibold">{t.settings.family}</h2>
            <label className="mt-3 grid gap-1 text-sm">
              <span className="text-xs text-zinc-500">{t.settings.familyName}</span>
              <input className={INPUT} value={settings.familyName} onChange={(e) => setSettings({ ...settings, familyName: e.target.value })} maxLength={60} />
            </label>
            <p className="mt-2 text-xs text-zinc-500">{fmt(t.settings.usage, { n: family.usage[month] ?? 0 })}</p>
          </section>

          <section className={`${CARD} mt-4`}>
            <h2 className="font-semibold">{t.settings.children}</h2>
            <p className="mt-1 text-xs text-zinc-500">{t.settings.childHint}</p>
            <ul className="mt-3 grid gap-2">
              {children.map((c, i) => (
                <li key={c.id} className="flex items-center gap-2">
                  <input
                    type="color"
                    aria-label="color"
                    value={c.color}
                    onChange={(e) => setChildren(children.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)))}
                    className="h-8 w-8 cursor-pointer rounded-full border-0 bg-transparent p-0"
                  />
                  <input className={INPUT} value={c.name} maxLength={40} onChange={(e) => setChildren(children.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                  <button type="button" className={BTN_SMALL} onClick={() => setChildren(children.filter((_, j) => j !== i))}>
                    {t.settings.removeChild}
                  </button>
                </li>
              ))}
            </ul>
            {children.length < MAX_CHILDREN && (
              <form
                className="mt-3 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const name = newChild.trim();
                  if (!name) return;
                  setChildren([...children, { id: `new-${Date.now()}`, name, color: CHILD_COLORS[children.length % CHILD_COLORS.length] }]);
                  setNewChild("");
                }}
              >
                <input className={INPUT} placeholder={t.settings.childName} value={newChild} maxLength={40} onChange={(e) => setNewChild(e.target.value)} />
                <button type="submit" className={BTN_SECONDARY}>
                  {t.settings.addChild}
                </button>
              </form>
            )}
          </section>

          <section className={`${CARD} mt-4`}>
            <h2 className="font-semibold">{t.settings.region}</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-sm">
                <span className="text-xs text-zinc-500">{t.settings.country}</span>
                <select
                  className={INPUT}
                  value={settings.country}
                  onChange={(e) => {
                    const c = COUNTRIES.find((x) => x.code === e.target.value)!;
                    setSettings({ ...settings, country: c.code, dateOrder: c.dateOrder, currency: c.currency, weekStart: c.weekStart, timezone: c.timezone });
                  }}
                >
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-xs text-zinc-500">{t.settings.language}</span>
                <select className={INPUT} value={settings.language} onChange={(e) => setSettings({ ...settings, language: e.target.value })}>
                  {OUTPUT_LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-xs text-zinc-500">{t.settings.timezone}</span>
                <select className={INPUT} value={settings.timezone} onChange={(e) => setSettings({ ...settings, timezone: e.target.value })}>
                  {tzList.map((z) => (
                    <option key={z} value={z}>
                      {z}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-xs text-zinc-500">{t.settings.currency}</span>
                <input className={INPUT} value={settings.currency} maxLength={3} onChange={(e) => setSettings({ ...settings, currency: e.target.value.toUpperCase() })} />
              </label>
              <fieldset className="grid gap-1 text-sm">
                <legend className="text-xs text-zinc-500">{t.settings.dateOrder}</legend>
                {(["MDY", "DMY", "YMD"] as DateOrder[]).map((o) => (
                  <label key={o} className="inline-flex items-center gap-2">
                    <input type="radio" name="dateOrder" checked={settings.dateOrder === o} onChange={() => setSettings({ ...settings, dateOrder: o })} />
                    {t.settings.dateOrders[o]}
                  </label>
                ))}
              </fieldset>
              <fieldset className="grid gap-1 text-sm">
                <legend className="text-xs text-zinc-500">{t.settings.weekStart}</legend>
                <label className="inline-flex items-center gap-2">
                  <input type="radio" name="weekStart" checked={settings.weekStart === 1} onChange={() => setSettings({ ...settings, weekStart: 1 })} />
                  {t.settings.monday}
                </label>
                <label className="inline-flex items-center gap-2">
                  <input type="radio" name="weekStart" checked={settings.weekStart === 0} onChange={() => setSettings({ ...settings, weekStart: 0 })} />
                  {t.settings.sunday}
                </label>
              </fieldset>
            </div>
          </section>

          <div className="mt-4 flex items-center gap-3">
            <button type="button" className={BTN_PRIMARY} disabled={saving} onClick={save}>
              {t.settings.save}
            </button>
            {justSaved && <span className="text-sm text-emerald-700 dark:text-emerald-300">{t.settings.saved}</span>}
          </div>

          <section id="calendar" className={`${CARD} mt-8 border-indigo-200 dark:border-indigo-900`}>
            <h2 className="font-semibold">{t.settings.calendar}</h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{t.settings.calendarBody}</p>
            <code className="mt-3 block select-all break-all rounded-lg bg-zinc-100 px-3 py-2 text-xs dark:bg-zinc-800">{feedUrl(family.feedToken)}</code>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className={BTN_SECONDARY} onClick={() => copy(feedUrl(family.feedToken), "feed")}>
                {copied === "feed" ? t.settings.copied : t.settings.copyFeed}
              </button>
              <a href={feedUrl(family.feedToken)} className={BTN_SECONDARY} download="parentdesk.ics">
                .ics
              </a>
              <button type="button" className={BTN_SMALL} onClick={rotate}>
                {t.settings.rotateFeed}
              </button>
            </div>
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer font-medium">{t.settings.howToSubscribe}</summary>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-zinc-700 dark:text-zinc-300">
                {t.settings.subscribeSteps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </details>
          </section>

          <section className={`${CARD} mt-4`}>
            <h2 className="font-semibold">{t.settings.inbound}</h2>
            {family.inboundAddress ? (
              <>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{t.settings.inboundBody}</p>
                <code className="mt-3 block select-all break-all rounded-lg bg-zinc-100 px-3 py-2 text-xs dark:bg-zinc-800">{family.inboundAddress}</code>
                <button type="button" className={`${BTN_SECONDARY} mt-3`} onClick={() => copy(family.inboundAddress as string, "inbound")}>
                  {copied === "inbound" ? t.settings.copied : t.common.copy}
                </button>
              </>
            ) : (
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{t.settings.inboundOff}</p>
            )}
          </section>

          <section className={`${CARD} mt-4`}>
            <h2 className="font-semibold">{t.settings.share}</h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{t.settings.shareBody}</p>
            {storedKey ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button type="button" className={BTN_SECONDARY} onClick={() => setShowKey((s) => !s)}>
                  {showKey ? t.settings.hideKey : t.settings.showKey}
                </button>
                <button type="button" className={BTN_SECONDARY} onClick={() => copy(storedKey, "key")}>
                  {copied === "key" ? t.settings.copied : t.settings.copyKey}
                </button>
                {showKey && <code className="block w-full select-all break-all rounded-lg bg-zinc-100 px-3 py-2 text-xs dark:bg-zinc-800">{storedKey}</code>}
              </div>
            ) : null}
            <p className="mt-2 text-xs text-zinc-500">{t.settings.keyNote}</p>
          </section>
        </>
      )}

      <section className={`${CARD} mt-4`}>
        <h2 className="font-semibold">{t.settings.joinTitle}</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{t.settings.joinBody}</p>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void join();
          }}
        >
          <input className={INPUT} placeholder={t.settings.joinPlaceholder} value={joinKey} onChange={(e) => setJoinKey(e.target.value)} autoComplete="off" spellCheck={false} />
          <button type="submit" className={BTN_SECONDARY} disabled={!joinKey.trim()}>
            {t.settings.join}
          </button>
        </form>
        {joinError && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{t.settings.joinError}</p>}
      </section>

      {family && (
        <section className={`${CARD} mt-4`}>
          <h2 className="font-semibold">{t.settings.leave}</h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{t.settings.leaveBody}</p>
          <button type="button" className={`${BTN_SECONDARY} mt-3`} onClick={leave}>
            {t.settings.leave}
          </button>
          <h2 className="mt-6 font-semibold text-red-700 dark:text-red-400">{t.settings.deleteFamily}</h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{t.settings.deleteBody}</p>
          <button type="button" className={`${BTN_SECONDARY} mt-3 border-red-300 text-red-700 dark:border-red-800 dark:text-red-400`} onClick={destroy}>
            {t.settings.deleteFamily}
          </button>
        </section>
      )}

      {copyFailed && (
        <p role="status" className="mt-3 text-xs text-amber-700 dark:text-amber-300">
          {t.common.copyFailed}
        </p>
      )}
    </main>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, browserTimezone, feedUrl, forgetKey, readKey, rememberKey, writeClipboard } from "@/lib/client";
import { COUNTRIES, TIMEZONES, type DateOrder } from "@/lib/countries";
import { useFamily } from "@/lib/family-context";
import { useI18n } from "@/lib/i18n/context";
import { fmt } from "@/lib/i18n";
import { LOCALE_TAGS, localePath, regionName } from "@/lib/i18n/locales";
import { OUTPUT_LANGUAGES } from "@/lib/schema";
import { CHILD_COLORS, MAX_CHILDREN, type Child, type Settings } from "@/lib/types";
import { BTN_PRIMARY, BTN_SECONDARY, BTN_SMALL, CARD, INPUT } from "@/lib/ui";
import ChildChips from "./ChildChips";

export default function SettingsView() {
  const { locale, t } = useI18n();
  const { family, loading, setFamily, refresh } = useFamily();
  const params = useSearchParams();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [children, setChildren] = useState<Child[]>([]);
  const [newChild, setNewChild] = useState("");
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [copied, setCopied] = useState<"" | "feed" | "key" | "inbound" | "invite">("");
  const [copyFailed, setCopyFailed] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [joinKey, setJoinKey] = useState("");
  const [joinError, setJoinError] = useState(false);
  const [storedKey, setStoredKey] = useState("");
  const [scanning, setScanning] = useState(false);
  const [gmailNote, setGmailNote] = useState<string | null>(null);
  const [gmailError, setGmailError] = useState<string | null>(null);
  const [billingNote, setBillingNote] = useState<string | null>(null);
  const [billingBusy, setBillingBusy] = useState(false);
  const [digestNote, setDigestNote] = useState<string | null>(null);
  const [digestBusy, setDigestBusy] = useState(false);
  const [preview, setPreview] = useState<{ subject: string; text: string } | null>(null);
  const [invite, setInvite] = useState<{ url: string; expiresAt: string } | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState(false);
  const [roomBusy, setRoomBusy] = useState<string | null>(null);
  const [membersText, setMembersText] = useState("");

  // The form is a draft of the server document: reload it whenever the document changes.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing a draft from server data
    setStoredKey(readKey());
    if (family) {
      setSettings(family.settings);
      setChildren(family.children);
      setMembersText((family.settings.members ?? []).join(", "));
    }
  }, [family]);

  // Back from Google (/api/google/callback?gmail=...): show the outcome and, when the
  // connection is new, check the inbox straight away.
  const gmailParam = params.get("gmail");
  useEffect(() => {
    if (!gmailParam || loading) return;
    const statuses = t.settings.gmailStatus as Record<string, string>;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading the URL once
    setGmailNote(statuses[gmailParam] ?? null);
    window.history.replaceState(null, "", window.location.pathname);
    if (gmailParam === "connected" && family?.gmail) void scan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gmailParam, loading]);

  // Back from Stripe (?billing=success|cancel) or an unsubscribe link (?digest=off|badlink).
  const billingParam = params.get("billing");
  const digestParam = params.get("digest");
  useEffect(() => {
    if ((!billingParam && !digestParam) || loading) return;
    const b = t.settings.billingStatus as Record<string, string>;
    const d = t.settings.digestStatus as Record<string, string>;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading the URL once
    if (billingParam) setBillingNote(b[billingParam] ?? null);
    if (digestParam) setDigestNote(d[digestParam] ?? null);
    window.history.replaceState(null, "", window.location.pathname);
    // The webhook may land a moment after the redirect: look again shortly.
    if (billingParam === "success") setTimeout(() => void refresh(), 4000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billingParam, digestParam, loading]);

  if (loading) return <p className="p-8 text-center text-sm text-zinc-500">{t.common.loading}</p>;

  async function openBilling(kind: "checkout" | "portal") {
    setBillingBusy(true);
    setBillingNote(null);
    try {
      const res = kind === "checkout" ? await api.checkout("month") : await api.portal();
      window.location.href = res.url;
    } catch {
      setBillingNote(t.settings.billingStatus.error);
      setBillingBusy(false);
    }
  }

  async function sendDigestTest() {
    if (!settings) return;
    setDigestBusy(true);
    setDigestNote(null);
    try {
      const saved = await api.updateFamily({ settings: { ...settings, locale }, children });
      setFamily(saved.family);
      const res = await api.digestSend();
      setFamily(res.family);
      setDigestNote(t.settings.digestSent);
    } catch {
      setDigestNote(t.settings.digestError);
    } finally {
      setDigestBusy(false);
    }
  }

  async function showPreview() {
    if (preview) {
      setPreview(null);
      return;
    }
    try {
      const res = await api.digestPreview();
      setPreview({ subject: res.subject, text: res.text });
    } catch {
      setDigestNote(t.add.errors.generic);
    }
  }

  async function makeInvite() {
    setInviteBusy(true);
    setInviteError(false);
    try {
      const res = await api.invite(locale);
      setInvite({ url: res.url, expiresAt: res.expiresAt });
      setFamily(res.family);
    } catch {
      setInviteError(true);
    } finally {
      setInviteBusy(false);
    }
  }

  async function shareInvite() {
    if (!invite) return;
    try {
      await navigator.share({ title: t.meta.siteName, url: invite.url });
    } catch {
      /* dismissed or unsupported */
    }
  }

  async function scan() {
    setScanning(true);
    setGmailError(null);
    try {
      const res = await api.gmailScan();
      setFamily(res.family);
      setGmailNote(null);
      if (res.result.error) setGmailError(res.result.error === "reconnect" ? t.settings.gmailPaused : t.add.errors.generic);
    } catch {
      setGmailError(t.add.errors.generic);
    } finally {
      setScanning(false);
    }
  }

  async function disconnectGmail() {
    if (!window.confirm(t.settings.gmailDisconnectConfirm)) return;
    const res = await api.gmailDisconnect();
    setFamily(res.family);
    setGmailNote(null);
  }

  async function copy(text: string, what: "feed" | "key" | "inbound" | "invite") {
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
      const res = await api.updateFamily({ settings: { ...settings, locale, members: membersText.split(",").map((m) => m.trim()).filter(Boolean).slice(0, 6) }, children });
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
  // Country names in the UI language (the browser's own data), "Other" from the dictionary.
  const countryOptions = COUNTRIES.map((c) => ({ code: c.code, label: c.code === "XX" ? t.settings.countryOther : regionName(c.code, LOCALE_TAGS[locale], c.name) })).sort((a, b) =>
    a.code === "XX" ? 1 : b.code === "XX" ? -1 : a.label.localeCompare(b.label, LOCALE_TAGS[locale]),
  );
  async function toggleRoomChild(roomId: string, current: string[], childId: string) {
    setRoomBusy(roomId);
    try {
      const next = current.includes(childId) ? current.filter((x) => x !== childId) : [...current, childId];
      const res = await api.roomChildren(roomId, next);
      setFamily(res.family);
    } finally {
      setRoomBusy(null);
    }
  }

  async function leaveRoom(roomId: string) {
    if (!window.confirm(t.settings.roomLeaveConfirm)) return;
    setRoomBusy(roomId);
    try {
      const res = await api.roomLeave(roomId);
      setFamily(res.family);
    } finally {
      setRoomBusy(null);
    }
  }

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
            <label className="mt-3 grid gap-1 text-sm">
              <span className="text-xs text-zinc-500">{t.settings.members}</span>
              <input className={INPUT} value={membersText} placeholder={t.settings.membersPlaceholder} onChange={(e) => setMembersText(e.target.value)} maxLength={140} />
              <span className="text-xs text-zinc-500">{t.settings.membersHint}</span>
            </label>
            <p className="mt-2 text-xs text-zinc-500">{fmt(t.settings.usage, { n: family.usage[month] ?? 0 })}</p>
          </section>

          <section className={`${CARD} mt-4`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">{t.settings.plan}</h2>
              <span className="rounded-full bg-indigo-100 px-3 py-0.5 text-xs font-semibold text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-200">
                {family.plan === "family" ? t.settings.planFamily : t.settings.planFree}
              </span>
            </div>
            {billingNote && (
              <p className="mt-2 text-sm text-indigo-700 dark:text-indigo-300" role="status">
                {billingNote}
              </p>
            )}
            {!family.features.billing ? (
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{t.settings.planBeta}</p>
            ) : family.plan === "family" ? (
              <div className="mt-2 text-sm">
                <p className="text-zinc-600 dark:text-zinc-400">{t.settings.planFamilyBody}</p>
                {family.billing?.status === "past_due" && <p className="mt-1 text-amber-700 dark:text-amber-300">{t.settings.planPastDue}</p>}
                {family.billing?.currentPeriodEnd && family.billing.status !== "past_due" && (
                  <p className="mt-1 text-zinc-600 dark:text-zinc-400">
                    {fmt(family.billing.cancelAtPeriodEnd ? t.settings.planEnds : t.settings.planRenews, {
                      date: new Date(family.billing.currentPeriodEnd).toLocaleDateString(LOCALE_TAGS[locale], { dateStyle: "medium" }),
                    })}
                  </p>
                )}
                {family.billing && (
                  <button type="button" className={`${BTN_SECONDARY} mt-3`} disabled={billingBusy} onClick={() => openBilling("portal")}>
                    {t.settings.manageBilling}
                  </button>
                )}
              </div>
            ) : (
              <div className="mt-2 text-sm">
                <p className="text-zinc-600 dark:text-zinc-400">{fmt(t.settings.planFreeBody, { n: family.limits.freeNotices, k: family.limits.freeChildren })}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" className={BTN_PRIMARY} disabled={billingBusy} onClick={() => openBilling("checkout")}>
                    {t.settings.upgrade}
                  </button>
                  <Link href={localePath(locale, "/pricing")} className={BTN_SECONDARY}>
                    {t.nav.pricing}
                  </Link>
                </div>
              </div>
            )}
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
                <input className={`${INPUT} min-w-0`} placeholder={t.settings.childName} value={newChild} maxLength={40} onChange={(e) => setNewChild(e.target.value)} />
                <button type="submit" className={`${BTN_SECONDARY} shrink-0 whitespace-nowrap`}>
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
                  {countryOptions.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.label}
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
            <h2 className="font-semibold">{t.settings.auto}</h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{t.settings.autoBody}</p>

            <h3 className="mt-4 text-sm font-semibold">{t.settings.gmail}</h3>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{t.settings.gmailBody}</p>
            {gmailNote && (
              <p className="mt-2 text-sm text-indigo-700 dark:text-indigo-300" role="status">
                {gmailNote}
              </p>
            )}
            {family.gmail ? (
              <div className="mt-2 text-sm">
                <p className="font-medium">{fmt(t.settings.gmailConnected, { email: family.gmail.email })}</p>
                <p className="mt-1 text-zinc-600 dark:text-zinc-400">
                  {family.gmail.lastScanAt
                    ? fmt(t.settings.gmailLastScan, { when: new Date(family.gmail.lastScanAt).toLocaleString(LOCALE_TAGS[locale], { dateStyle: "medium", timeStyle: "short" }) })
                    : t.settings.gmailNever}
                </p>
                {family.gmail.lastResult && !family.gmail.lastResult.error && (
                  <p className="mt-1 text-zinc-600 dark:text-zinc-400">{fmt(t.settings.gmailResult, family.gmail.lastResult as unknown as Record<string, number>)}</p>
                )}
                {family.gmail.senders.length > 0 && <p className="mt-1 text-xs text-zinc-500">{fmt(t.settings.gmailSenders, { n: family.gmail.senders.length })}</p>}
                {(family.gmail.paused || family.gmail.lastResult?.error === "reconnect") && <p className="mt-1 text-amber-700 dark:text-amber-300">{t.settings.gmailPaused}</p>}
                {gmailError && <p className="mt-1 text-red-600 dark:text-red-400">{gmailError}</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" className={BTN_SECONDARY} disabled={scanning} onClick={scan}>
                    {scanning ? t.settings.gmailScanning : t.settings.gmailScan}
                  </button>
                  {(family.gmail.paused || family.gmail.lastResult?.error === "reconnect") && (
                    <button type="button" className={BTN_SECONDARY} onClick={() => {
                      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full navigation to an API route that redirects to Google
                      window.location.href = `${window.location.origin}/api/google/start`;
                    }}>
                      {t.settings.gmailConnect}
                    </button>
                  )}
                  <button type="button" className={BTN_SMALL} onClick={disconnectGmail}>
                    {t.settings.gmailDisconnect}
                  </button>
                </div>
              </div>
            ) : family.features.gmail ? (
              <button type="button" className={`${BTN_PRIMARY} mt-3`} onClick={() => {
                      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full navigation to an API route that redirects to Google
                      window.location.href = `${window.location.origin}/api/google/start`;
                    }}>
                {t.settings.gmailConnect}
              </button>
            ) : (
              <p className="mt-2 text-sm text-zinc-500">{t.settings.gmailOff}</p>
            )}

            <h3 className="mt-5 text-sm font-semibold">{t.settings.shareTitle}</h3>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{t.settings.shareAppBody}</p>
          </section>

          <section className={`${CARD} mt-4`}>
            <h2 className="font-semibold">{t.settings.rooms}</h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{t.settings.roomsBody}</p>
            {(family.rooms ?? []).length === 0 ? (
              <p className="mt-3 text-sm text-zinc-500">{t.settings.roomsEmpty}</p>
            ) : (
              <ul className="mt-3 grid gap-3">
                {(family.rooms ?? []).map((r) => (
                  <li key={r.roomId} className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
                    <p dir="auto" className="font-medium">{r.school ? `${r.school} · ${r.name}` : r.name}</p>
                    {r.teacherName && <p dir="auto" className="text-xs text-zinc-500">{r.teacherName}</p>}
                    {family.children.length > 0 && (
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                        <span className="text-zinc-500">{t.settings.roomChildren}</span>
                        <ChildChips childrenList={family.children} selected={r.childIds} onToggle={(id) => void toggleRoomChild(r.roomId, r.childIds, id)} />
                      </div>
                    )}
                    <button type="button" disabled={roomBusy === r.roomId} className={`${BTN_SMALL} mt-3 text-red-600 dark:text-red-400`} onClick={() => leaveRoom(r.roomId)}>
                      {t.settings.roomLeave}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-zinc-500">
              <Link href={localePath(locale, "/teach")} className="underline underline-offset-4">
                {t.settings.roomTeacherLink}
              </Link>
            </p>
          </section>

          <section className={`${CARD} mt-4`}>
            <h2 className="font-semibold">{t.settings.digest}</h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{t.settings.digestBody}</p>
            {digestNote && (
              <p className="mt-2 text-sm text-indigo-700 dark:text-indigo-300" role="status">
                {digestNote}
              </p>
            )}
            {family.features.billing && family.plan !== "family" ? (
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                {t.settings.digestFamilyOnly}{" "}
                <Link href={localePath(locale, "/pricing")} className="underline underline-offset-4">
                  {t.settings.upgrade}
                </Link>
              </p>
            ) : (
              <>
                <label className="mt-3 grid gap-1 text-sm">
                  <span className="text-xs text-zinc-500">{t.settings.digestEmail}</span>
                  <input
                    className={INPUT}
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    value={settings.digestEmail}
                    maxLength={120}
                    onChange={(e) => setSettings({ ...settings, digestEmail: e.target.value, digest: e.target.value.trim() ? settings.digest : false })}
                  />
                </label>
                <label className="mt-2 inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={settings.digest} disabled={!settings.digestEmail.trim()} onChange={(e) => setSettings({ ...settings, digest: e.target.checked })} />
                  {t.settings.digestOn}
                </label>
                {!family.features.digest && <p className="mt-2 text-xs text-zinc-500">{t.settings.digestOff}</p>}
                {family.digest?.lastSentAt && (
                  <p className="mt-2 text-xs text-zinc-500">
                    {fmt(t.settings.digestLast, { when: new Date(family.digest.lastSentAt).toLocaleString(LOCALE_TAGS[locale], { dateStyle: "medium", timeStyle: "short" }) })}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button type="button" className={BTN_PRIMARY} disabled={saving} onClick={save}>
                    {t.settings.save}
                  </button>
                  {family.features.digest && (
                    <button type="button" className={BTN_SECONDARY} disabled={digestBusy || !settings.digestEmail.trim()} onClick={sendDigestTest}>
                      {t.settings.digestTest}
                    </button>
                  )}
                  <button type="button" className={BTN_SMALL} onClick={showPreview}>
                    {t.settings.digestPreview}
                  </button>
                  {justSaved && <span className="text-sm text-emerald-700 dark:text-emerald-300">{t.settings.saved}</span>}
                </div>
                {preview && (
                  <div className="mt-3 rounded-lg bg-zinc-100 p-3 text-xs dark:bg-zinc-800">
                    <p className="font-semibold">{preview.subject}</p>
                    <pre className="mt-2 whitespace-pre-wrap font-sans" dir="auto">
                      {preview.text}
                    </pre>
                  </div>
                )}
              </>
            )}
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
            <h3 className="mt-3 text-sm font-semibold">{t.settings.invite}</h3>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{t.settings.inviteBody}</p>
            {family.features.billing && family.plan !== "family" ? (
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                {t.settings.inviteFamilyOnly}{" "}
                <Link href={localePath(locale, "/pricing")} className="underline underline-offset-4">
                  {t.settings.upgrade}
                </Link>
              </p>
            ) : (
              <>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" className={invite ? BTN_SECONDARY : BTN_PRIMARY} disabled={inviteBusy} onClick={makeInvite}>
                    {t.settings.inviteCreate}
                  </button>
                  {invite && (
                    <button type="button" className={BTN_SECONDARY} onClick={() => copy(invite.url, "invite")}>
                      {copied === "invite" ? t.settings.copied : t.settings.inviteCopy}
                    </button>
                  )}
                  {invite && typeof navigator !== "undefined" && typeof navigator.share === "function" && (
                    <button type="button" className={BTN_SECONDARY} onClick={shareInvite}>
                      {t.settings.inviteShare}
                    </button>
                  )}
                </div>
                {invite && (
                  <>
                    <code className="mt-3 block select-all break-all rounded-lg bg-zinc-100 px-3 py-2 text-xs dark:bg-zinc-800">{invite.url}</code>
                    <p className="mt-1 text-xs text-zinc-500">{fmt(t.settings.inviteExpires, { date: new Date(invite.expiresAt).toLocaleString(LOCALE_TAGS[locale], { dateStyle: "medium", timeStyle: "short" }) })}</p>
                  </>
                )}
                {inviteError && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{t.settings.inviteError}</p>}
              </>
            )}

            <h3 className="mt-5 text-sm font-semibold">{t.settings.showKey}</h3>
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
          <input className={`${INPUT} min-w-0`} placeholder={t.settings.joinPlaceholder} value={joinKey} onChange={(e) => setJoinKey(e.target.value)} autoComplete="off" spellCheck={false} />
          <button type="submit" className={`${BTN_SECONDARY} shrink-0 whitespace-nowrap`} disabled={!joinKey.trim()}>
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

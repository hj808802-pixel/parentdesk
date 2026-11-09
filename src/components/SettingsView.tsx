"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, browserTimezone, feedUrl, forgetKey, hookUrl, readKey, rememberKey, writeClipboard } from "@/lib/client";
import { COUNTRIES, TIMEZONES, type DateOrder } from "@/lib/countries";
import { useFamily } from "@/lib/family-context";
import { useI18n } from "@/lib/i18n/context";
import { fmt } from "@/lib/i18n";
import { LOCALE_TAGS, localePath, regionName } from "@/lib/i18n/locales";
import { OUTPUT_LANGUAGES, type SetupSection } from "@/lib/schema";
import { FLAG_CALENDAR, isInstalled, readFlag } from "@/lib/setup";
import { CHILD_COLORS, MAX_CHILDREN, type Child, type Settings } from "@/lib/types";
import { BTN_PRIMARY, BTN_SECONDARY, BTN_SMALL, CARD, INPUT } from "@/lib/ui";
import CalendarLinks from "./CalendarLinks";
import ChildChips from "./ChildChips";
import InstallCard from "./InstallCard";
import SetupHelper from "./SetupHelper";

// Settings, easiest things first: the three-step setup (children, calendar, home screen),
// the assistant that changes settings from plain words, then the family and region, and
// everything optional folded away under "more settings".

const GROUP = "group rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900";
const SUMMARY = "flex cursor-pointer list-none items-center justify-between gap-2 p-4 font-semibold [&::-webkit-details-marker]:hidden";

function Chevron() {
  return (
    <span className="text-zinc-400 transition group-open:rotate-180" aria-hidden>
      ⌄
    </span>
  );
}

export default function SettingsView() {
  const { locale, t } = useI18n();
  const { family, loading, setFamily, refresh } = useFamily();
  const params = useSearchParams();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [children, setChildren] = useState<Child[]>([]);
  const [newChild, setNewChild] = useState("");
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [copied, setCopied] = useState<"" | "feed" | "key" | "inbound" | "invite" | "hook">("");
  const [hookNote, setHookNote] = useState<"" | "ok" | "fail">("");
  const [hookBusy, setHookBusy] = useState(false);
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
  const [calLinked, setCalLinked] = useState(false);
  const [installed, setInstalled] = useState(false);

  // The form is a draft of the server document: reload it whenever the document changes.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing a draft from server data
    setStoredKey(readKey());
    setCalLinked(readFlag(FLAG_CALENDAR));
    setInstalled(isInstalled());
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

  // Scroll to a section, opening the folded group it sits in.
  function go(section: SetupSection) {
    const el = document.getElementById(section);
    if (!el) return;
    let p: HTMLElement | null = el;
    while (p) {
      if (p instanceof HTMLDetailsElement) p.open = true;
      p = p.parentElement;
    }
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

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

  async function copy(text: string, what: "feed" | "key" | "inbound" | "invite" | "hook") {
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
  // A ping proves the address works without reading anything or calling a model.
  async function testHook() {
    if (!family) return;
    setHookBusy(true);
    setHookNote("");
    try {
      const res = await fetch(hookUrl(family.hookToken), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ping: true }) });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; ping?: boolean } | null;
      setHookNote(res.ok && body?.ok && body.ping ? "ok" : "fail");
    } catch {
      setHookNote("fail");
    } finally {
      setHookBusy(false);
    }
  }

  async function rotateHookAddress() {
    if (!window.confirm(t.settings.hookRotateConfirm)) return;
    setHookBusy(true);
    try {
      const res = await api.rotateHook();
      setFamily(res.family);
      setHookNote("");
    } finally {
      setHookBusy(false);
    }
  }

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
  const su = t.settings.setup;
  const steps: { id: SetupSection; n: number; done: boolean; label: string; doneLabel: string }[] = family
    ? [
        { id: "children", n: 1, done: family.children.length > 0, label: su.stepChildren, doneLabel: su.stepChildrenDone },
        { id: "calendar", n: 2, done: calLinked, label: su.stepCalendar, doneLabel: su.stepCalendarDone },
        { id: "install", n: 3, done: installed, label: su.stepInstall, doneLabel: su.stepInstallDone },
      ]
    : [];

  const joinCard = (
    <section id="join" className={`${CARD} mt-4`}>
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
  );

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
          <section id="setup" className={`${CARD} mt-4 border-indigo-200 bg-indigo-50/60 dark:border-indigo-900 dark:bg-indigo-950/30`}>
            <h2 className="font-semibold">{su.title}</h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{su.body}</p>
            <ol className="mt-3 grid gap-2">
              {steps.map((s) => (
                <li key={s.id}>
                  <button type="button" onClick={() => go(s.id)} className="flex w-full items-center gap-3 rounded-xl border border-zinc-200 bg-white px-3 py-3 text-left text-sm dark:border-zinc-800 dark:bg-zinc-900">
                    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${s.done ? "bg-emerald-600" : "bg-indigo-600"}`} aria-hidden>
                      {s.done ? "✓" : s.n}
                    </span>
                    <span className="min-w-0 flex-1 font-medium">{s.done ? s.doneLabel : s.label}</span>
                    <span className="shrink-0 text-xs text-zinc-500">{s.done ? su.done : su.todo}</span>
                  </button>
                </li>
              ))}
            </ol>
            <button type="button" onClick={() => go("share")} className="mt-3 text-left text-xs text-zinc-600 underline underline-offset-4 dark:text-zinc-400">
              {su.keyHint}
            </button>
          </section>

          <SetupHelper onGo={go} />

          <section id="children" className={`${CARD} mt-4`}>
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
            <div className="mt-3 flex items-center gap-3">
              <button type="button" className={BTN_PRIMARY} disabled={saving} onClick={save}>
                {t.settings.save}
              </button>
              {justSaved && <span className="text-sm text-emerald-700 dark:text-emerald-300">{t.settings.saved}</span>}
            </div>
          </section>

          <section id="calendar" className={`${CARD} mt-4 border-indigo-200 dark:border-indigo-900`}>
            <h2 className="font-semibold">{t.settings.calendar}</h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{t.settings.calendarBody}</p>
            <CalendarLinks feedToken={family.feedToken} name={family.settings.familyName} onLinked={() => setCalLinked(true)} />
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer font-medium">{su.calOther}</summary>
              <code className="mt-2 block select-all break-all rounded-lg bg-zinc-100 px-3 py-2 text-xs dark:bg-zinc-800">{feedUrl(family.feedToken)}</code>
              <div className="mt-2 flex flex-wrap gap-2">
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
              <p className="mt-3 font-medium">{t.settings.howToSubscribe}</p>
              <ol className="mt-1 list-decimal space-y-1 pl-5 text-zinc-700 dark:text-zinc-300">
                {t.settings.subscribeSteps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </details>
          </section>

          <InstallCard onInstalled={setInstalled} />

          <section id="family" className={`${CARD} mt-4`}>
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

          <section id="region" className={`${CARD} mt-4`}>
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
            <div className="mt-4 flex items-center gap-3">
              <button type="button" className={BTN_PRIMARY} disabled={saving} onClick={save}>
                {t.settings.save}
              </button>
              {justSaved && <span className="text-sm text-emerald-700 dark:text-emerald-300">{t.settings.saved}</span>}
            </div>
          </section>

          <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-zinc-500">{su.more}</h2>

          <details id="rooms" className={`${GROUP} mt-3`} open={(family.rooms ?? []).length > 0}>
            <summary className={SUMMARY}>
              {t.settings.rooms}
              <Chevron />
            </summary>
            <div className="px-4 pb-4">
              <p className="text-sm text-zinc-600 dark:text-zinc-400">{t.settings.roomsBody}</p>
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
            </div>
          </details>

          <details id="collect" className={`${GROUP} mt-3`}>
            <summary className={SUMMARY}>
              {su.groupCollect}
              <Chevron />
            </summary>
            <div className="px-4 pb-4">
              <p className="text-sm text-zinc-600 dark:text-zinc-400">{t.settings.autoBody}</p>

              <h3 className="mt-4 text-sm font-semibold">{t.settings.hook}</h3>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{t.settings.hookBody}</p>
              <code className="mt-2 block select-all break-all rounded-lg bg-zinc-100 px-3 py-2 text-xs dark:bg-zinc-800">{hookUrl(family.hookToken)}</code>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className={BTN_SECONDARY} onClick={() => copy(hookUrl(family.hookToken), "hook")}>
                  {copied === "hook" ? t.settings.copied : t.common.copy}
                </button>
                <button type="button" className={BTN_SECONDARY} disabled={hookBusy} onClick={testHook}>
                  {hookBusy ? t.settings.hookTesting : t.settings.hookTest}
                </button>
                <button type="button" className={BTN_SMALL} disabled={hookBusy} onClick={rotateHookAddress}>
                  {t.settings.hookRotate}
                </button>
              </div>
              {hookNote === "ok" && <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-300">{t.settings.hookTested}</p>}
              {hookNote === "fail" && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{t.settings.hookTestFailed}</p>}
              <details className="mt-2 text-sm">
                <summary className="cursor-pointer font-medium">{t.settings.hookHow}</summary>
                <p className="mt-2 font-medium">{t.settings.hookIphone}</p>
                <ol className="mt-1 list-decimal space-y-1 pl-5 text-zinc-700 dark:text-zinc-300">
                  {t.settings.hookIphoneSteps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ol>
                <p className="mt-3 font-medium">{t.settings.hookAndroid}</p>
                <ol className="mt-1 list-decimal space-y-1 pl-5 text-zinc-700 dark:text-zinc-300">
                  {t.settings.hookAndroidSteps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ol>
                <p className="mt-2 text-xs text-zinc-500">{t.settings.hookNote}</p>
              </details>

              <h3 className="mt-5 text-sm font-semibold">{t.settings.gmail}</h3>
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
                      <button
                        type="button"
                        className={BTN_SECONDARY}
                        onClick={() => {
                          // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full navigation to an API route that redirects to Google
                          window.location.href = `${window.location.origin}/api/google/start`;
                        }}
                      >
                        {t.settings.gmailConnect}
                      </button>
                    )}
                    <button type="button" className={BTN_SMALL} onClick={disconnectGmail}>
                      {t.settings.gmailDisconnect}
                    </button>
                  </div>
                </div>
              ) : family.features.gmail ? (
                <button
                  type="button"
                  className={`${BTN_PRIMARY} mt-3`}
                  onClick={() => {
                    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full navigation to an API route that redirects to Google
                    window.location.href = `${window.location.origin}/api/google/start`;
                  }}
                >
                  {t.settings.gmailConnect}
                </button>
              ) : (
                <p className="mt-2 text-sm text-zinc-500">{t.settings.gmailOff}</p>
              )}

              <h3 className="mt-5 text-sm font-semibold">{t.settings.inbound}</h3>
              {family.inboundAddress ? (
                <>
                  <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{t.settings.inboundBody}</p>
                  <code className="mt-2 block select-all break-all rounded-lg bg-zinc-100 px-3 py-2 text-xs dark:bg-zinc-800">{family.inboundAddress}</code>
                  <button type="button" className={`${BTN_SECONDARY} mt-2`} onClick={() => copy(family.inboundAddress as string, "inbound")}>
                    {copied === "inbound" ? t.settings.copied : t.common.copy}
                  </button>
                </>
              ) : (
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{t.settings.inboundOff}</p>
              )}

              <h3 className="mt-5 text-sm font-semibold">{t.settings.shareTitle}</h3>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{t.settings.shareAppBody}</p>
            </div>
          </details>

          <details id="share" className={`${GROUP} mt-3`}>
            <summary className={SUMMARY}>
              {su.groupShare}
              <Chevron />
            </summary>
            <div className="px-4 pb-4">
              <h3 className="text-sm font-semibold">{t.settings.invite}</h3>
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

              <h3 className="mt-5 text-sm font-semibold">{t.settings.joinTitle}</h3>
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
            </div>
          </details>

          <details id="digest" className={`${GROUP} mt-3`}>
            <summary className={SUMMARY}>
              {t.settings.digest}
              <Chevron />
            </summary>
            <div className="px-4 pb-4">
              <p className="text-sm text-zinc-600 dark:text-zinc-400">{t.settings.digestBody}</p>
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
            </div>
          </details>

          <details id="plan" className={`${GROUP} mt-3`}>
            <summary className={SUMMARY}>
              <span className="flex flex-wrap items-center gap-2">
                {t.settings.plan}
                <span className="rounded-full bg-indigo-100 px-3 py-0.5 text-xs font-semibold text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-200">
                  {family.plan === "family" ? t.settings.planFamily : t.settings.planFree}
                </span>
              </span>
              <Chevron />
            </summary>
            <div className="px-4 pb-4">
              {billingNote && (
                <p className="mb-2 text-sm text-indigo-700 dark:text-indigo-300" role="status">
                  {billingNote}
                </p>
              )}
              {!family.features.billing ? (
                <p className="text-sm text-zinc-600 dark:text-zinc-400">{t.settings.planBeta}</p>
              ) : family.plan === "family" ? (
                <div className="text-sm">
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
                <div className="text-sm">
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
            </div>
          </details>

          <details id="danger" className={`${GROUP} mt-3`}>
            <summary className={SUMMARY}>
              {su.groupDanger}
              <Chevron />
            </summary>
            <div className="px-4 pb-4">
              <h3 className="text-sm font-semibold">{t.settings.leave}</h3>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{t.settings.leaveBody}</p>
              <button type="button" className={`${BTN_SECONDARY} mt-3`} onClick={leave}>
                {t.settings.leave}
              </button>
              <h3 className="mt-6 text-sm font-semibold text-red-700 dark:text-red-400">{t.settings.deleteFamily}</h3>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{t.settings.deleteBody}</p>
              <button type="button" className={`${BTN_SECONDARY} mt-3 border-red-300 text-red-700 dark:border-red-800 dark:text-red-400`} onClick={destroy}>
                {t.settings.deleteFamily}
              </button>
            </div>
          </details>
        </>
      )}

      {!family && joinCard}

      {copyFailed && (
        <p role="status" className="mt-3 text-xs text-amber-700 dark:text-amber-300">
          {t.common.copyFailed}
        </p>
      )}
    </main>
  );
}

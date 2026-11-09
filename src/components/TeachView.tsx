"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, ApiFailure, browserTimezone, forgetTeacherKey, readTeacherKey, rememberTeacherKey, roomJoinUrl, writeClipboard, type RoomPostResponse } from "@/lib/client";
import { COUNTRIES, TIMEZONES } from "@/lib/countries";
import { formatDate } from "@/lib/dates";
import { useI18n } from "@/lib/i18n/context";
import { fmt } from "@/lib/i18n";
import { LOCALE_TAGS, localePath, regionName } from "@/lib/i18n/locales";
import { shrinkImage } from "@/lib/image";
import type { RoomPost, RoomView, TeacherView } from "@/lib/rooms";
import { NOTICE_KINDS, OUTPUT_LANGUAGES, type NoticeKind } from "@/lib/schema";
import { BTN_PRIMARY, BTN_SECONDARY, BTN_SMALL, CARD, INPUT, TYPE_STYLES } from "@/lib/ui";

// /teach: the teacher's desk. Create it, open rooms, share each room's link, read a notice
// in, check what was extracted, send it (to one room or several), recall it if needed.
// The teacher key lives in the pd_teacher cookie; the browser remembers it in local
// storage so it can be shown here, exactly like the family key in Settings.

const MAX_FILES = 5;
const MAX_MB = 4;

const languageLabel = (code: string) => OUTPUT_LANGUAGES.find((l) => l.code === code)?.label ?? code;

export default function TeachView() {
  const { locale, t } = useI18n();
  const [teacher, setTeacher] = useState<TeacherView | null>(null);
  const [loading, setLoading] = useState(true);
  const [storedKey, setStoredKey] = useState("");
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [keyError, setKeyError] = useState(false);
  const [newRoom, setNewRoom] = useState("");
  const [roomError, setRoomError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [profile, setProfile] = useState<{ name: string; school: string; language: string; country: string; timezone: string } | null>(null);
  const [profileSaved, setProfileSaved] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState("");
  const [copyFailed, setCopyFailed] = useState(false);

  const errorText = (code: string, vars: Record<string, string | number> = {}) => {
    const dict = { ...(t.add.errors as Record<string, string>), ...(t.teach.errors as Record<string, string>) };
    return fmt(dict[code] ?? dict.generic, { mb: MAX_MB, n: MAX_FILES, ...vars });
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from the server
    setStoredKey(readTeacherKey());
    api
      .teacher()
      .then((res) => setTeacher(res.teacher))
      .catch(() => setTeacher(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing a draft from server data
    if (teacher) setProfile({ name: teacher.name, school: teacher.school, language: teacher.settings.language, country: teacher.settings.country, timezone: teacher.settings.timezone });
  }, [teacher]);

  async function copy(text: string, what: string) {
    const ok = await writeClipboard(text);
    setCopied(ok ? what : "");
    setCopyFailed(!ok);
    setTimeout(() => {
      setCopied("");
      setCopyFailed(false);
    }, 2500);
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      const res = await api.createTeacher({ name: name.trim(), locale, timezone: browserTimezone() });
      rememberTeacherKey(res.key);
      setStoredKey(res.key ?? "");
      setTeacher(res.teacher);
    } catch (err) {
      setCreateError(errorText(err instanceof ApiFailure ? err.code : "generic"));
    } finally {
      setCreating(false);
    }
  }

  async function openWithKey(e: React.FormEvent) {
    e.preventDefault();
    setKeyError(false);
    try {
      const res = await api.joinTeacher(keyInput.trim());
      rememberTeacherKey(keyInput.trim());
      setStoredKey(keyInput.trim());
      setTeacher(res.teacher);
      setKeyInput("");
    } catch {
      setKeyError(true);
    }
  }

  async function saveProfile() {
    if (!profile) return;
    setBusy(true);
    try {
      const res = await api.updateTeacher({ name: profile.name, school: profile.school, settings: { language: profile.language, country: profile.country, timezone: profile.timezone } });
      setTeacher(res.teacher);
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 3000);
    } finally {
      setBusy(false);
    }
  }

  async function addRoom(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setRoomError(null);
    try {
      const res = await api.createRoom(newRoom.trim());
      setTeacher(res.teacher);
      setNewRoom("");
    } catch (err) {
      setRoomError(errorText(err instanceof ApiFailure ? err.code : "generic"));
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    await api.leaveTeacher();
    forgetTeacherKey();
    setStoredKey("");
    setTeacher(null);
  }

  async function destroy() {
    if (!window.confirm(t.teach.deleteConfirm)) return;
    await api.deleteTeacher();
    forgetTeacherKey();
    setStoredKey("");
    setTeacher(null);
  }

  if (loading) return <p className="p-8 text-center text-sm text-zinc-500">{t.common.loading}</p>;

  if (!teacher) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-8">
        <section className="text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">{t.teach.eyebrow}</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">{t.teach.title}</h1>
          <p className="mx-auto mt-4 max-w-2xl text-base text-zinc-600 dark:text-zinc-400">{t.teach.lead}</p>
        </section>
        <ol className="mt-8 grid gap-3 sm:grid-cols-3">
          {t.teach.how.map((s, i) => (
            <li key={i} className={CARD}>
              <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">{fmt(t.landing.step, { n: i + 1 })}</p>
              <p className="mt-1 text-sm">{s}</p>
            </li>
          ))}
        </ol>
        <form onSubmit={create} className={`${CARD} mt-6`}>
          <label className="grid gap-1 text-sm">
            <span className="text-xs text-zinc-500">{t.teach.yourName}</span>
            <input className={INPUT} value={name} onChange={(e) => setName(e.target.value)} placeholder={t.teach.yourNamePlaceholder} maxLength={60} required />
          </label>
          {createError && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{createError}</p>}
          <button type="submit" className={`${BTN_PRIMARY} mt-4`} disabled={creating || !name.trim()}>
            {t.teach.create}
          </button>
          <p className="mt-3 text-xs text-zinc-500">{t.teach.privacy}</p>
        </form>
        <form onSubmit={openWithKey} className={`${CARD} mt-4`}>
          <h2 className="font-semibold">{t.teach.haveKey}</h2>
          <div className="mt-3 flex gap-2">
            <input className={`${INPUT} min-w-0`} placeholder={t.teach.keyPlaceholder} value={keyInput} onChange={(e) => setKeyInput(e.target.value)} autoComplete="off" spellCheck={false} />
            <button type="submit" className={`${BTN_SECONDARY} shrink-0 whitespace-nowrap`} disabled={!keyInput.trim()}>
              {t.teach.open}
            </button>
          </div>
          {keyError && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{t.teach.keyError}</p>}
        </form>
      </main>
    );
  }

  const month = new Date().toISOString().slice(0, 7);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <h1 className="text-2xl font-bold">{t.teach.title}</h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{fmt(t.teach.usage, { n: teacher.usage[month] ?? 0, limit: teacher.postCap })}</p>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">{t.teach.rooms}</h2>
        {teacher.rooms.length === 0 && <p className="mt-2 text-sm text-zinc-500">{t.teach.noRooms}</p>}
        <div className="mt-3 grid gap-4">
          {teacher.rooms.map((room) => (
            <RoomCard key={room.id} room={room} teacher={teacher} onTeacher={setTeacher} copy={copy} copied={copied} errorText={errorText} />
          ))}
        </div>
        <form onSubmit={addRoom} className={`${CARD} mt-4`}>
          <label className="grid gap-1 text-sm">
            <span className="text-xs text-zinc-500">{t.teach.newRoom}</span>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input className={INPUT} value={newRoom} onChange={(e) => setNewRoom(e.target.value)} placeholder={t.teach.newRoomPlaceholder} maxLength={60} />
              <button type="submit" className={`${BTN_PRIMARY} shrink-0`} disabled={busy || !newRoom.trim()}>
                {t.teach.addRoom}
              </button>
            </div>
          </label>
          {roomError && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{roomError}</p>}
        </form>
      </section>

      {profile && (
        <section className={`${CARD} mt-8`}>
          <h2 className="font-semibold">{t.teach.yourName}</h2>
          <input className={`${INPUT} mt-3`} value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} maxLength={60} />
          <label className="mt-3 grid gap-1 text-sm">
            <span className="text-xs text-zinc-500">{t.teach.school}</span>
            <input className={INPUT} value={profile.school} onChange={(e) => setProfile({ ...profile, school: e.target.value })} placeholder={t.teach.schoolPlaceholder} maxLength={80} />
            <span className="text-xs text-zinc-500">{t.teach.schoolHint}</span>
          </label>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span className="text-xs text-zinc-500">{t.teach.language}</span>
              <select className={INPUT} value={profile.language} onChange={(e) => setProfile({ ...profile, language: e.target.value })}>
                {OUTPUT_LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-xs text-zinc-500">{t.teach.country}</span>
              <select className={INPUT} value={profile.country} onChange={(e) => setProfile({ ...profile, country: e.target.value })}>
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code === "XX" ? t.settings.countryOther : regionName(c.code, LOCALE_TAGS[locale], c.name)}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-xs text-zinc-500">{t.settings.timezone}</span>
              <select className={INPUT} value={profile.timezone} onChange={(e) => setProfile({ ...profile, timezone: e.target.value })}>
                {(TIMEZONES.includes(profile.timezone) ? TIMEZONES : [profile.timezone, ...TIMEZONES]).map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button type="button" className={BTN_SECONDARY} disabled={busy || !profile.name.trim()} onClick={saveProfile}>
              {t.teach.save}
            </button>
            {profileSaved && <span className="text-sm text-emerald-700 dark:text-emerald-300">{t.teach.saved}</span>}
          </div>
          <p className="mt-3 text-xs text-zinc-500">{t.teach.privacy}</p>
        </section>
      )}

      <ParentMessageHelper errorText={errorText} />

      <section className={`${CARD} mt-4`}>
        <h2 className="font-semibold">{t.teach.yourKey}</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{t.teach.keyBody}</p>
        {storedKey && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" className={BTN_SECONDARY} onClick={() => setShowKey((s) => !s)}>
              {showKey ? t.teach.hideKey : t.teach.showKey}
            </button>
            <button type="button" className={BTN_SECONDARY} onClick={() => copy(storedKey, "key")}>
              {copied === "key" ? t.common.copied : t.teach.copyKey}
            </button>
            {showKey && <code className="block w-full select-all break-all rounded-lg bg-zinc-100 px-3 py-2 text-xs dark:bg-zinc-800">{storedKey}</code>}
          </div>
        )}
        <p className="mt-2 text-xs text-zinc-500">{t.teach.keyNote}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className={BTN_SECONDARY} onClick={leave}>
            {t.teach.leave}
          </button>
          <button type="button" className={`${BTN_SECONDARY} border-red-300 text-red-700 dark:border-red-800 dark:text-red-400`} onClick={destroy}>
            {t.teach.deleteDesk}
          </button>
        </div>
      </section>

      {copyFailed && (
        <p role="status" className="mt-3 text-xs text-amber-700 dark:text-amber-300">
          {t.common.copyFailed}
        </p>
      )}
      <p className="mt-6 text-xs text-zinc-500">
        <Link href={localePath(locale, "/privacy")} className="underline underline-offset-4">
          {t.nav.privacy}
        </Link>
      </p>
    </main>
  );
}

type Note = { kind: "ok" | "warn" | "error"; text: string; langs?: string };

function RoomCard({
  room,
  teacher,
  onTeacher,
  copy,
  copied,
  errorText,
}: {
  room: RoomView;
  teacher: TeacherView;
  onTeacher: (tv: TeacherView) => void;
  copy: (text: string, what: string) => Promise<void>;
  copied: string;
  errorText: (code: string, vars?: Record<string, string | number>) => string;
}) {
  const { locale, t } = useI18n();
  const tag = LOCALE_TAGS[locale];
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [reading, setReading] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  const [showPosts, setShowPosts] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [openPost, setOpenPost] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [drop, setDrop] = useState<Record<string, number[]>>({});
  const [targets, setTargets] = useState<Record<string, string[]>>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const link = roomJoinUrl(room.joinToken, localePath(locale, "/join"));
  const posts = [...room.posts].reverse();
  const otherRooms = teacher.rooms.filter((r) => r.id !== room.id);

  async function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setPreparing(true);
    try {
      const prepared = await Promise.all(Array.from(list).slice(0, MAX_FILES - files.length).map((f) => shrinkImage(f)));
      const kept = prepared.filter((f) => f.size <= MAX_MB * 1024 * 1024);
      if (kept.length < prepared.length) setNote({ kind: "error", text: errorText("too_large") });
      setFiles((cur) => [...cur, ...kept].slice(0, MAX_FILES));
    } finally {
      setPreparing(false);
    }
  }

  // Reads the notice into a draft; nothing reaches the families until the teacher sends it.
  async function preview() {
    setReading(true);
    setNote(null);
    const form = new FormData();
    form.set("mode", "preview");
    if (text.trim()) form.set("text", text.trim());
    files.forEach((f) => form.append("files", f));
    try {
      const res = await fetch(`/api/teacher/rooms/${room.id}/post`, { method: "POST", body: form });
      const body = (await res.json().catch(() => null)) as (RoomPostResponse & { error?: string; used?: number; limit?: number }) | null;
      if (!res.ok || !body || !body.ok) {
        setNote({ kind: "error", text: errorText(body?.error ?? "generic", { used: body?.used ?? 0, limit: body?.limit ?? 0 }) });
        return;
      }
      if (!body.school_related || !body.draft) {
        setNote({ kind: "warn", text: t.teach.postNotSchool });
        return;
      }
      if (body.teacher) onTeacher(body.teacher);
      setText("");
      setFiles([]);
    } catch {
      setNote({ kind: "error", text: errorText("generic") });
    } finally {
      setReading(false);
    }
  }

  async function send(draft: RoomPost) {
    const dropped = drop[draft.id] ?? [];
    if (dropped.length >= draft.items.length) {
      setNote({ kind: "error", text: t.teach.noneSelected });
      return;
    }
    setBusy(draft.id);
    setNote(null);
    try {
      const res = await api.roomDraftSend(room.id, draft.id, { drop: dropped, targets: targets[draft.id] ?? [] });
      onTeacher(res.teacher);
      setNote({
        kind: "ok",
        text: fmt(t.teach.postDone, { items: res.post.items.length, n: res.delivered }),
        langs: res.languages.length ? fmt(t.teach.postLanguages, { langs: res.languages.map(languageLabel).join(", ") }) : undefined,
      });
      setShowPosts(true);
      setOpenPost(res.post.id);
    } catch (err) {
      setNote({ kind: "error", text: errorText(err instanceof ApiFailure ? err.code : "generic") });
    } finally {
      setBusy(null);
    }
  }

  async function discard(draft: RoomPost) {
    if (!window.confirm(t.teach.discardConfirm)) return;
    setBusy(draft.id);
    try {
      onTeacher((await api.roomDraftDiscard(room.id, draft.id)).teacher);
    } catch (err) {
      setNote({ kind: "error", text: errorText(err instanceof ApiFailure ? err.code : "generic") });
    } finally {
      setBusy(null);
    }
  }

  async function recall(post: RoomPost) {
    if (!window.confirm(t.teach.recallConfirm)) return;
    setBusy(post.id);
    try {
      const res = await api.roomPostRecall(room.id, post.id);
      onTeacher(res.teacher);
      setNote({ kind: "ok", text: fmt(t.teach.recalled, { n: res.families }) });
    } catch (err) {
      setNote({ kind: "error", text: errorText(err instanceof ApiFailure ? err.code : "generic") });
    } finally {
      setBusy(null);
    }
  }

  async function rename() {
    const next = window.prompt(t.teach.newRoom, room.name);
    if (!next || !next.trim() || next.trim() === room.name) return;
    setBusy("room");
    try {
      onTeacher((await api.updateRoom(room.id, { name: next.trim() })).teacher);
    } finally {
      setBusy(null);
    }
  }

  async function editNote() {
    const next = window.prompt(`${t.teach.description}\n${t.teach.descriptionPlaceholder}`, room.description);
    if (next === null || next.trim() === room.description) return;
    setBusy("room");
    try {
      onTeacher((await api.updateRoom(room.id, { description: next.trim() })).teacher);
    } finally {
      setBusy(null);
    }
  }

  async function rotate() {
    if (!window.confirm(t.teach.rotateConfirm)) return;
    setBusy("room");
    try {
      onTeacher((await api.updateRoom(room.id, { rotate: true })).teacher);
    } finally {
      setBusy(null);
    }
  }

  async function close() {
    if (!window.confirm(t.teach.deleteRoomConfirm)) return;
    setBusy("room");
    try {
      onTeacher((await api.deleteRoom(room.id)).teacher);
    } finally {
      setBusy(null);
    }
  }

  async function share() {
    try {
      await navigator.share({ title: `${t.meta.siteName} · ${room.name}`, url: link });
    } catch {
      /* dismissed or unsupported */
    }
  }

  const toggleDrop = (draftId: string, i: number) =>
    setDrop((cur) => {
      const set = cur[draftId] ?? [];
      return { ...cur, [draftId]: set.includes(i) ? set.filter((x) => x !== i) : [...set, i] };
    });
  const toggleTarget = (draftId: string, id: string) =>
    setTargets((cur) => {
      const set = cur[draftId] ?? [];
      return { ...cur, [draftId]: set.includes(id) ? set.filter((x) => x !== id) : [...set, id] };
    });
  const recipients = (draftId: string) => room.memberCount + otherRooms.filter((r) => (targets[draftId] ?? []).includes(r.id)).reduce((sum, r) => sum + r.memberCount, 0);

  const roomBusy = busy === "room";

  return (
    <article className={`${CARD} border-emerald-200 dark:border-emerald-900`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 dir="auto" className="text-lg font-semibold">{room.name}</h3>
          <p dir="auto" className="text-xs text-zinc-500">
            {fmt(t.teach.following, { n: room.memberCount })} · {[teacher.school, teacher.name].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={BTN_SMALL} disabled={roomBusy} onClick={rename}>
            {t.teach.rename}
          </button>
          <button type="button" className={`${BTN_SMALL} text-red-600 dark:text-red-400`} disabled={roomBusy} onClick={close}>
            {t.teach.deleteRoom}
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-start gap-2 text-sm">
        {room.description ? (
          <p dir="auto" className="min-w-0 flex-1 rounded-lg bg-zinc-50 px-3 py-2 text-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300">{room.description}</p>
        ) : (
          <p className="min-w-0 flex-1 text-xs text-zinc-500">{t.teach.description}</p>
        )}
        <button type="button" className={BTN_SMALL} disabled={roomBusy} onClick={editNote}>
          {t.teach.descriptionEdit}
        </button>
      </div>

      <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-zinc-500">{t.teach.link}</p>
      <code className="mt-1 block select-all break-all rounded-lg bg-zinc-100 px-3 py-2 text-xs dark:bg-zinc-800">{link}</code>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className={BTN_SECONDARY} onClick={() => copy(link, `link-${room.id}`)}>
          {copied === `link-${room.id}` ? t.common.copied : t.teach.copyLink}
        </button>
        {typeof navigator !== "undefined" && typeof navigator.share === "function" && (
          <button type="button" className={BTN_SECONDARY} onClick={share}>
            {t.teach.shareLink}
          </button>
        )}
        <button type="button" className={BTN_SMALL} onClick={() => setShowQr((s) => !s)}>
          {showQr ? t.teach.hideQr : t.teach.showQr}
        </button>
        <button type="button" className={BTN_SMALL} disabled={roomBusy} onClick={rotate}>
          {t.teach.rotate}
        </button>
      </div>
      {showQr && (
        <figure className="mt-3 inline-block rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-700">
          {/* eslint-disable-next-line @next/next/no-img-element -- an SVG the server draws for this room */}
          <img src={`/api/teacher/rooms/${room.id}/qr?l=${locale}&v=${room.joinToken.slice(-6)}`} alt={t.teach.link} width={208} height={208} className="h-52 w-52" />
          <figcaption className="mt-2 max-w-52 text-xs text-zinc-600">{t.teach.qrHint}</figcaption>
        </figure>
      )}

      <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-zinc-500">{t.teach.post}</p>
      <ComposePanel roomId={room.id} onDraft={(draft) => setText(draft)} errorText={errorText} />
      <label className="mt-1 grid gap-1 text-sm">
        <span className="sr-only">{t.teach.postText}</span>
        <textarea className={INPUT} rows={5} placeholder={t.teach.postPlaceholder} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
        multiple
        className="sr-only"
        onChange={(e) => {
          void addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        {files.length < MAX_FILES && (
          <button type="button" className="underline underline-offset-4" onClick={() => inputRef.current?.click()}>
            {t.teach.postFiles}
          </button>
        )}
        {files.map((f, i) => (
          <span key={i} className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800">
            {f.type === "application/pdf" ? "PDF" : "IMG"} {f.name.slice(0, 20)}
            <button type="button" aria-label={t.add.removePage} onClick={() => setFiles(files.filter((_, j) => j !== i))}>
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" className={BTN_PRIMARY} disabled={reading || preparing || (text.trim().length < 10 && files.length === 0)} onClick={preview}>
          {reading ? t.add.working : t.teach.preview}
        </button>
        {preparing && !reading && <span className="text-sm text-zinc-500">{t.add.preparing}</span>}
      </div>

      {room.drafts.length > 0 && (
        <section className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">{t.teach.drafts}</p>
          <p className="mt-1 text-xs text-zinc-500">{t.teach.draftHint}</p>
          <div className="mt-2 grid gap-3">
            {[...room.drafts].reverse().map((d) => {
              const dropped = drop[d.id] ?? [];
              return (
                <div key={d.id} className="rounded-xl border border-amber-200 bg-amber-50/50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/20">
                  <p dir="auto" className="font-semibold">{d.title}</p>
                  <p dir="auto" className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{d.summary}</p>
                  <ul className="mt-2 grid gap-1">
                    {d.items.map((it, i) => (
                      <li key={i}>
                        <label className={`flex items-start gap-2 ${dropped.includes(i) ? "opacity-50" : ""}`}>
                          <input type="checkbox" className="mt-0.5" checked={!dropped.includes(i)} onChange={() => toggleDrop(d.id, i)} />
                          <span className="min-w-0">
                            <span className={`mr-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${TYPE_STYLES[it.type].badge}`}>{t.item.types[it.type]}</span>
                            {it.date && <span className="mr-1 text-xs text-zinc-600 dark:text-zinc-400">{formatDate(it.date, tag)}</span>}
                            <span dir="auto">{it.title}</span>
                            {it.description && <span dir="auto" className="block text-xs text-zinc-500">{it.description}</span>}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                  {otherRooms.length > 0 && (
                    <fieldset className="mt-3">
                      <legend className="text-xs text-zinc-500">{t.teach.sendAlso}</legend>
                      <div className="mt-1 flex flex-wrap gap-2">
                        {otherRooms.map((r) => {
                          const on = (targets[d.id] ?? []).includes(r.id);
                          return (
                            <label key={r.id} className={`cursor-pointer rounded-full border px-3 py-1 text-xs ${on ? "border-emerald-600 bg-emerald-600 text-white" : "border-zinc-300 dark:border-zinc-700"}`}>
                              <input type="checkbox" className="sr-only" checked={on} onChange={() => toggleTarget(d.id, r.id)} />
                              {r.name} · {r.memberCount}
                            </label>
                          );
                        })}
                      </div>
                    </fieldset>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" className={BTN_PRIMARY} disabled={busy === d.id || dropped.length >= d.items.length} onClick={() => send(d)}>
                      {busy === d.id ? t.teach.postWorking : fmt(t.teach.sendTo, { n: recipients(d.id) })}
                    </button>
                    <button type="button" className={BTN_SMALL} disabled={busy === d.id} onClick={() => discard(d)}>
                      {t.teach.discard}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {note && (
        <p
          role="status"
          className={`mt-3 rounded-lg px-3 py-2 text-sm ${
            note.kind === "ok"
              ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
              : note.kind === "warn"
                ? "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
                : "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"
          }`}
        >
          {note.text}
          {note.langs && <span className="block text-xs opacity-80">{note.langs}</span>}
        </p>
      )}

      <div className="mt-4">
        <button type="button" className="text-sm underline underline-offset-4" onClick={() => setShowPosts((s) => !s)}>
          {t.teach.posts} ({room.posts.length})
        </button>
        {showPosts && (
          <ul className="mt-2 grid gap-2">
            {posts.length === 0 && <li className="text-sm text-zinc-500">{t.teach.noPosts}</li>}
            {posts.slice(0, 10).map((p) => (
              <li key={p.id} className="rounded-xl border border-zinc-200 p-3 text-sm dark:border-zinc-800">
                <button type="button" className="flex w-full flex-wrap items-baseline justify-between gap-2 text-left" onClick={() => setOpenPost(openPost === p.id ? null : p.id)}>
                  <span dir="auto" className="font-medium">{p.title}</span>
                  <span className="text-xs text-zinc-500">
                    {formatDate(p.ts.slice(0, 10), tag, { month: "short", day: "numeric" })} · {fmt(t.teach.postedTo, { items: p.items.length, n: p.delivered })}
                  </span>
                </button>
                {openPost === p.id && (
                  <div className="mt-2">
                    <ul className="grid gap-1">
                      {p.items.map((it, i) => {
                        const tl = p.tally?.[String(i)];
                        return (
                          <li key={i} className="flex flex-wrap items-center gap-2 text-xs">
                            <span className={`rounded-full px-2 py-0.5 font-medium ${TYPE_STYLES[it.type].badge}`}>{t.item.types[it.type]}</span>
                            {it.date && <span className="text-zinc-600 dark:text-zinc-400">{formatDate(it.date, tag)}</span>}
                            <span dir="auto">{it.title}</span>
                            {tl && tl.done > 0 && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200">✓ {fmt(t.teach.tallyDone, { n: tl.done })}</span>}
                            {tl && tl.dismissed > 0 && <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{fmt(t.teach.tallyDismissed, { n: tl.dismissed })}</span>}
                          </li>
                        );
                      })}
                      {p.tally && Object.keys(p.tally).length > 0 && <li className="text-xs text-zinc-500">{fmt(t.teach.tallyHint, { n: p.delivered })}</li>}
                      {Object.keys(p.translations).length > 0 && (
                        <li className="text-xs text-zinc-500">{fmt(t.teach.postLanguages, { langs: Object.keys(p.translations).map(languageLabel).join(", ") })}</li>
                      )}
                    </ul>
                    <button type="button" className={`${BTN_SMALL} mt-2 text-red-600 dark:text-red-400`} disabled={busy === p.id} onClick={() => recall(p)}>
                      {t.teach.recall}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}

// A few facts in, a complete notice out, dropped into the post box for the teacher to edit.
function ComposePanel({ roomId, onDraft, errorText }: { roomId: string; onDraft: (text: string) => void; errorText: (code: string) => string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<NoticeKind>("general");
  const [facts, setFacts] = useState("");
  const [tone, setTone] = useState<"formal" | "friendly">("formal");
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setMissing(null);
    try {
      const res = await api.compose(roomId, { kind, facts: facts.trim(), tone });
      onDraft(res.notice);
      setMissing(res.missing);
    } catch (err) {
      setError(errorText(err instanceof ApiFailure ? err.code : "generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-1">
      <button type="button" className={`${BTN_SMALL} ${open ? "bg-zinc-100 dark:bg-zinc-800" : ""}`} onClick={() => setOpen((o) => !o)}>
        ✍ {t.teach.compose}
      </button>
      {open && (
        <div className="mt-2 rounded-xl border border-indigo-200 bg-indigo-50/50 p-3 text-sm dark:border-indigo-900 dark:bg-indigo-950/20">
          <p className="text-xs text-zinc-600 dark:text-zinc-400">{t.teach.composeHint}</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className="grid gap-1">
              <span className="text-xs text-zinc-500">{t.teach.composeKind}</span>
              <select className={INPUT} value={kind} onChange={(e) => setKind(e.target.value as NoticeKind)}>
                {NOTICE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t.teach.kinds[k]}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="grid gap-1">
              <legend className="text-xs text-zinc-500">{t.teach.composeTone}</legend>
              <div className="flex gap-2">
                {(["formal", "friendly"] as const).map((v) => (
                  <label key={v} className={`cursor-pointer rounded-full border px-3 py-1 text-xs ${tone === v ? "border-indigo-600 bg-indigo-600 text-white" : "border-zinc-300 dark:border-zinc-700"}`}>
                    <input type="radio" name={`tone-${roomId}`} className="sr-only" checked={tone === v} onChange={() => setTone(v)} />
                    {v === "formal" ? t.teach.toneFormal : t.teach.toneFriendly}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
          <label className="mt-2 grid gap-1">
            <span className="text-xs text-zinc-500">{t.teach.composeFacts}</span>
            <textarea className={INPUT} rows={4} value={facts} placeholder={t.teach.composeFactsPlaceholder} onChange={(e) => setFacts(e.target.value)} maxLength={4000} />
          </label>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" className={BTN_PRIMARY} disabled={busy || facts.trim().length < 5} onClick={run}>
              {busy ? t.teach.composeWorking : t.teach.composeRun}
            </button>
          </div>
          {error && <p className="mt-2 text-red-600 dark:text-red-400">{error}</p>}
          {missing && (
            <div className="mt-2 text-xs">
              <p className="text-emerald-800 dark:text-emerald-200">{t.teach.composeDone}</p>
              {missing.length > 0 && (
                <p className="mt-1 text-amber-800 dark:text-amber-200">
                  {t.teach.composeMissing}: {missing.join(", ")}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// A parent's message in any language: what it says, and a reply to paste back.
function ParentMessageHelper({ errorText }: { errorText: (code: string) => string }) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ language: string; translation: string; summary: string; reply: string; reply_translated: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.translateParent(text.trim());
      setResult({ language: res.language, translation: res.translation, summary: res.summary, reply: res.reply, reply_translated: res.reply_translated });
    } catch (err) {
      setError(errorText(err instanceof ApiFailure ? err.code : "generic"));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!result) return;
    setCopied(await writeClipboard(result.reply));
    setTimeout(() => setCopied(false), 2500);
  }

  return (
    <section className={`${CARD} mt-4 border-sky-200 dark:border-sky-900`}>
      <h2 className="font-semibold">{t.teach.helper}</h2>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{t.teach.helperHint}</p>
      <textarea dir="auto" className={`${INPUT} mt-3`} rows={4} value={text} placeholder={t.teach.helperPlaceholder} onChange={(e) => setText(e.target.value)} maxLength={4000} />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" className={BTN_PRIMARY} disabled={busy || text.trim().length < 2} onClick={run}>
          {busy ? t.teach.helperWorking : t.teach.helperRun}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {result && (
        <div className="mt-3 grid gap-3 text-sm" aria-live="polite">
          <p className="text-xs text-zinc-500">{fmt(t.teach.helperLanguage, { lang: result.language })}</p>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{t.teach.helperSummary}</p>
            <p dir="auto" className="mt-1 font-medium">{result.summary}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{t.teach.helperTranslation}</p>
            <p dir="auto" className="mt-1 whitespace-pre-wrap">{result.translation}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{t.teach.helperReply}</p>
            <textarea dir="auto" className={`${INPUT} mt-1`} rows={5} value={result.reply} onChange={(e) => setResult({ ...result, reply: e.target.value })} />
            <details className="mt-2">
              <summary className="cursor-pointer text-xs font-medium">{t.teach.helperReplyMine}</summary>
              <p dir="auto" className="mt-1 whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">{result.reply_translated}</p>
            </details>
            <div className="mt-2 flex gap-2">
              <button type="button" className={BTN_SMALL} onClick={copy}>
                {copied ? t.common.copied : t.common.copy}
              </button>
            </div>
            <p className="mt-2 text-xs text-zinc-500">{t.reply.disclaimer}</p>
          </div>
        </div>
      )}
    </section>
  );
}

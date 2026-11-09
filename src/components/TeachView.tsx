"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, ApiFailure, browserTimezone, forgetTeacherKey, readTeacherKey, rememberTeacherKey, roomJoinUrl, writeClipboard, type RoomPostResponse } from "@/lib/client";
import { COUNTRIES } from "@/lib/countries";
import { formatDate } from "@/lib/dates";
import { useI18n } from "@/lib/i18n/context";
import { fmt } from "@/lib/i18n";
import { LOCALE_TAGS, localePath, regionName } from "@/lib/i18n/locales";
import { shrinkImage } from "@/lib/image";
import type { RoomView, TeacherView } from "@/lib/rooms";
import { OUTPUT_LANGUAGES } from "@/lib/schema";
import { BTN_PRIMARY, BTN_SECONDARY, BTN_SMALL, CARD, INPUT, TYPE_STYLES } from "@/lib/ui";

// /teach: the teacher's desk. Create it, open rooms, share each room's link, post notices.
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
  const [profile, setProfile] = useState<{ name: string; language: string; country: string } | null>(null);
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
    if (teacher) setProfile({ name: teacher.name, language: teacher.settings.language, country: teacher.settings.country });
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
      const res = await api.updateTeacher({ name: profile.name, settings: { language: profile.language, country: profile.country } });
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
            <input className={INPUT} placeholder={t.teach.keyPlaceholder} value={keyInput} onChange={(e) => setKeyInput(e.target.value)} autoComplete="off" spellCheck={false} />
            <button type="submit" className={BTN_SECONDARY} disabled={!keyInput.trim()}>
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
  const [posting, setPosting] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [note, setNote] = useState<{ kind: "ok" | "warn" | "error"; text: string; langs?: string } | null>(null);
  const [showPosts, setShowPosts] = useState(false);
  const [openPost, setOpenPost] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const link = roomJoinUrl(room.joinToken, localePath(locale, "/join"));
  const posts = [...room.posts].reverse();

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

  async function post() {
    setPosting(true);
    setNote(null);
    const form = new FormData();
    if (text.trim()) form.set("text", text.trim());
    files.forEach((f) => form.append("files", f));
    try {
      const res = await fetch(`/api/teacher/rooms/${room.id}/post`, { method: "POST", body: form });
      const body = (await res.json().catch(() => null)) as (RoomPostResponse & { error?: string; used?: number; limit?: number }) | null;
      if (!res.ok || !body || !body.ok) {
        setNote({ kind: "error", text: errorText(body?.error ?? "generic", { used: body?.used ?? 0, limit: body?.limit ?? 0 }) });
        return;
      }
      if (!body.saved || !body.post) {
        setNote({ kind: "warn", text: t.teach.postNotSchool });
        return;
      }
      if (body.teacher) onTeacher(body.teacher);
      setNote({
        kind: "ok",
        text: fmt(t.teach.postDone, { items: body.post.items.length, n: body.delivered ?? 0 }),
        langs: body.languages && body.languages.length ? fmt(t.teach.postLanguages, { langs: body.languages.map(languageLabel).join(", ") }) : undefined,
      });
      setText("");
      setFiles([]);
      setShowPosts(true);
      setOpenPost(body.post.id);
    } catch {
      setNote({ kind: "error", text: errorText("generic") });
    } finally {
      setPosting(false);
    }
  }

  async function rename() {
    const next = window.prompt(t.teach.newRoom, room.name);
    if (!next || !next.trim() || next.trim() === room.name) return;
    setBusy(true);
    try {
      onTeacher((await api.updateRoom(room.id, { name: next.trim() })).teacher);
    } finally {
      setBusy(false);
    }
  }

  async function rotate() {
    if (!window.confirm(t.teach.rotateConfirm)) return;
    setBusy(true);
    try {
      onTeacher((await api.updateRoom(room.id, { rotate: true })).teacher);
    } finally {
      setBusy(false);
    }
  }

  async function close() {
    if (!window.confirm(t.teach.deleteRoomConfirm)) return;
    setBusy(true);
    try {
      onTeacher((await api.deleteRoom(room.id)).teacher);
    } finally {
      setBusy(false);
    }
  }

  async function share() {
    try {
      await navigator.share({ title: `${t.meta.siteName} · ${room.name}`, url: link });
    } catch {
      /* dismissed or unsupported */
    }
  }

  return (
    <article className={`${CARD} border-emerald-200 dark:border-emerald-900`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 dir="auto" className="text-lg font-semibold">{room.name}</h3>
          <p className="text-xs text-zinc-500">
            {fmt(t.teach.following, { n: room.memberCount })} · {teacher.name}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={BTN_SMALL} disabled={busy} onClick={rename}>
            {t.teach.rename}
          </button>
          <button type="button" className={`${BTN_SMALL} text-red-600 dark:text-red-400`} disabled={busy} onClick={close}>
            {t.teach.deleteRoom}
          </button>
        </div>
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
        <button type="button" className={BTN_SMALL} disabled={busy} onClick={rotate}>
          {t.teach.rotate}
        </button>
      </div>

      <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-zinc-500">{t.teach.post}</p>
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
        <button type="button" className={BTN_PRIMARY} disabled={posting || preparing || (text.trim().length < 10 && files.length === 0)} onClick={post}>
          {posting ? t.teach.postWorking : t.teach.postSubmit}
        </button>
        {preparing && !posting && <span className="text-sm text-zinc-500">{t.add.preparing}</span>}
      </div>
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
                  <ul className="mt-2 grid gap-1">
                    {p.items.map((it, i) => (
                      <li key={i} className="flex flex-wrap items-center gap-2 text-xs">
                        <span className={`rounded-full px-2 py-0.5 font-medium ${TYPE_STYLES[it.type].badge}`}>{t.item.types[it.type]}</span>
                        {it.date && <span className="text-zinc-600 dark:text-zinc-400">{formatDate(it.date, tag)}</span>}
                        <span dir="auto">{it.title}</span>
                      </li>
                    ))}
                    {Object.keys(p.translations).length > 0 && (
                      <li className="text-xs text-zinc-500">{fmt(t.teach.postLanguages, { langs: Object.keys(p.translations).map(languageLabel).join(", ") })}</li>
                    )}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}

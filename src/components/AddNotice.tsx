"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFamily } from "@/lib/family-context";
import { useI18n } from "@/lib/i18n/context";
import { localePath } from "@/lib/i18n/locales";
import { fmt } from "@/lib/i18n";
import { browserTimezone, rememberKey } from "@/lib/client";
import { shrinkImage } from "@/lib/image";
import type { FamilyView, Item, Source } from "@/lib/store";
import { BTN_PRIMARY, BTN_SECONDARY, CARD, INPUT } from "@/lib/ui";
import ItemCard from "./ItemCard";

const MAX_FILES = 5;
const MAX_MB = 4;
const MAX_TOTAL_MB = 4.3; // mirrors the server (Vercel body limit)

type Result = {
  saved: boolean;
  source: Source | null;
  items: Item[];
  summary: string;
  questions: string[];
  school_related: boolean;
  family: FamilyView;
  key?: string;
  duplicates?: number;
  messages_seen?: number;
  messages_used?: number;
};

export default function AddNotice() {
  const { locale, t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const { family, loading, setFamily, patchItem, removeItem } = useFamily();

  const [tab, setTab] = useState<"files" | "text">("files");
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState("");
  const [child, setChild] = useState("");
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [sharedNote, setSharedNote] = useState<"none" | "dup" | "error" | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const autoSample = useRef(false);
  const sharedShown = useRef(false);

  const previews = useMemo(() => files.map((f) => (f.type.startsWith("image/") ? URL.createObjectURL(f) : null)), [files]);
  useEffect(() => () => previews.forEach((u) => u && URL.revokeObjectURL(u)), [previews]);

  async function submit(sample = false) {
    if (!sample && tab === "files" && files.reduce((sum, f) => sum + f.size, 0) > MAX_TOTAL_MB * 1024 * 1024) {
      setError(fmt(t.add.errors.too_large, { mb: MAX_MB, n: MAX_FILES }));
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    const form = new FormData();
    if (sample) form.set("sample", "1");
    else if (tab === "files") files.forEach((f) => form.append("files", f));
    else form.set("text", text);
    if (child) form.set("child", child);
    form.set("locale", locale);
    form.set("timezone", browserTimezone());
    try {
      const res = await fetch("/api/extract", { method: "POST", body: form });
      const body = (await res.json().catch(() => null)) as (Result & { ok: boolean; error?: string }) | null;
      if (!res.ok || !body || !body.ok) {
        const code = body?.error ?? "generic";
        const dict = t.add.errors as Record<string, string>;
        setError(fmt(dict[code] ?? dict.generic, { mb: MAX_MB, n: MAX_FILES }));
        return;
      }
      rememberKey(body.key);
      setFamily(body.family);
      setResult(body);
      setFiles([]);
      setText("");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setError(t.add.errors.generic);
    } finally {
      setBusy(false);
    }
  }

  // Landing here from the Android share sheet (/api/share): show what was just saved. A
  // family created by that request passes its key in the URL fragment, which is kept in
  // local storage like a key from a normal first upload and then dropped from the URL.
  useEffect(() => {
    const shared = params.get("shared");
    if (!shared || sharedShown.current || loading) return;
    sharedShown.current = true;
    const hash = window.location.hash;
    if (hash.startsWith("#key=")) {
      rememberKey(decodeURIComponent(hash.slice(5)));
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    if (shared === "none" || shared === "dup" || shared === "error") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reading the URL once
      setSharedNote(shared);
      return;
    }
    const source = family?.sources.find((s) => s.id === shared) ?? null;
    if (!source || !family) return;
    setResult({
      saved: true,
      source,
      items: family.items.filter((it) => it.sourceId === source.id),
      summary: source.summary,
      questions: source.questions,
      school_related: true,
      family,
      messages_seen: source.messagesSeen,
      messages_used: source.messagesUsed,
    });
  }, [params, loading, family]);

  // /add?sample=1 from the landing page runs the demo straight away.
  useEffect(() => {
    if (params.get("sample") === "1" && !autoSample.current && !loading) {
      autoSample.current = true;
      void submit(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, loading]);

  // Photos are shrunk in the browser first: phone cameras produce 3-12 MB files and the
  // server takes 4 MB per file. PDFs pass through and are checked against the limit here.
  async function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const picked = Array.from(list).slice(0, Math.max(0, MAX_FILES - files.length));
    if (picked.length === 0) return;
    setTab("files");
    setError(null);
    setPreparing(true);
    try {
      const prepared = await Promise.all(picked.map((f) => shrinkImage(f)));
      const limit = MAX_MB * 1024 * 1024;
      if (prepared.some((f) => f.size > limit)) setError(fmt(t.add.errors.too_large, { mb: MAX_MB, n: MAX_FILES }));
      const kept = prepared.filter((f) => f.size <= limit);
      if (kept.length > 0) setFiles((cur) => [...cur, ...kept].slice(0, MAX_FILES));
    } finally {
      setPreparing(false);
    }
  }

  const liveItems = result && family ? family.items.filter((it) => result.items.some((r) => r.id === it.id)) : [];

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      {result && (
        <section className="mb-8">
          <h1 className="text-2xl font-bold">{result.saved ? fmt(t.add.resultTitle, { n: result.items.length }) : t.add.title}</h1>
          {!result.school_related && <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">{t.add.notSchool}</p>}
          {result.school_related && result.items.length === 0 && !result.duplicates && <p className="mt-2 text-sm text-zinc-600">{t.add.resultNone}</p>}
          {result.school_related && result.items.length === 0 && Boolean(result.duplicates) && <p className="mt-2 text-sm text-zinc-600">{t.add.sharedDup}</p>}
          {Boolean(result.duplicates) && result.items.length > 0 && <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{fmt(t.add.duplicates, { n: result.duplicates ?? 0 })}</p>}
          {(result.messages_seen ?? 1) > 1 && (
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{fmt(t.add.mixed, { seen: result.messages_seen ?? 0, used: result.messages_used ?? 0 })}</p>
          )}
          {result.summary && (
            <div className={`${CARD} mt-3`}>
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{t.add.summary}</p>
              <p dir="auto" className="mt-1 text-sm">{result.summary}</p>
              {result.questions.length > 0 && (
                <>
                  <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">{t.add.questions}</p>
                  <ul className="mt-1 list-disc pl-5 text-sm">
                    {result.questions.map((q, i) => (
                      <li key={i}>{q}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
          {result.saved && <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">{t.add.savedHint}</p>}
          <div className="mt-3 grid gap-3">
            {liveItems.map((it) => (
              <ItemCard key={it.id} item={it} childrenList={result.family.children} timezone={result.family.settings.timezone} onPatch={patchItem} onRemove={removeItem} />
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className={BTN_SECONDARY} onClick={() => setResult(null)}>
              {t.add.addAnother}
            </button>
            <button type="button" className={BTN_PRIMARY} onClick={() => router.push(localePath(locale, "/"))}>
              {t.add.viewWeek}
            </button>
          </div>
        </section>
      )}

      {sharedNote && !result && (
        <p className={`mb-4 rounded-xl border px-4 py-3 text-sm ${sharedNote === "error" ? "border-red-200 text-red-700 dark:border-red-900 dark:text-red-300" : "border-amber-200 text-amber-800 dark:border-amber-900 dark:text-amber-200"}`} role="status">
          {sharedNote === "none" ? t.add.sharedNone : sharedNote === "dup" ? t.add.sharedDup : t.add.sharedError}
        </p>
      )}

      {!result && (
        <>
          <h1 className="text-2xl font-bold">{t.add.title}</h1>
          <div className="mt-4 flex gap-2" role="tablist">
            {(["files", "text"] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium ${tab === k ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "border border-zinc-300 dark:border-zinc-700"}`}
              >
                {k === "files" ? t.add.tabFiles : t.add.tabText}
              </button>
            ))}
          </div>

          {tab === "files" && (
            <div className={`${CARD} mt-4`}>
              <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif,application/pdf" multiple className="sr-only" onChange={(e) => {
                  void addFiles(e.target.files);
                  e.target.value = "";
                }} />
              {files.length === 0 ? (
                <div className="text-center">
                  <p className="font-medium">{t.add.emptyTitle}</p>
                  <p className="mt-1 text-sm text-zinc-500">{fmt(t.add.emptyHint, { n: MAX_FILES })}</p>
                  <button type="button" className={`${BTN_PRIMARY} mt-4`} onClick={() => inputRef.current?.click()}>
                    {t.add.choose}
                  </button>
                </div>
              ) : (
                <>
                  <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                    {files.map((f, i) => (
                      <li key={i} className="relative">
                        {previews[i] ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={previews[i] as string} alt="" className="h-28 w-full rounded-lg object-cover" />
                        ) : (
                          <div className="flex h-28 items-center justify-center rounded-lg bg-zinc-100 text-xs font-semibold dark:bg-zinc-800">PDF</div>
                        )}
                        <button type="button" className="absolute right-1 top-1 rounded-full bg-black/70 px-2 py-0.5 text-xs text-white" onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                          {t.add.removePage}
                        </button>
                      </li>
                    ))}
                  </ul>
                  {files.length < MAX_FILES && (
                    <button type="button" className="mt-3 text-sm underline underline-offset-4" onClick={() => inputRef.current?.click()}>
                      {t.add.addPage}
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {tab === "text" && (
            <div className={`${CARD} mt-4`}>
              <textarea className={INPUT} rows={10} placeholder={t.add.textPlaceholder} value={text} onChange={(e) => setText(e.target.value)} />
              <p className="mt-2 text-xs text-zinc-500">{t.add.textHint}</p>
            </div>
          )}

          {family && family.children.length > 0 && (
            <fieldset className="mt-4">
              <legend className="text-sm font-medium">{t.add.forChild}</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                <label className={`cursor-pointer rounded-full border px-3 py-1 text-sm ${child === "" ? "border-zinc-900 bg-zinc-900 text-white dark:border-white dark:bg-white dark:text-zinc-900" : "border-zinc-300 dark:border-zinc-700"}`}>
                  <input type="radio" name="child" value="" checked={child === ""} onChange={() => setChild("")} className="sr-only" />
                  {t.add.wholeFamily}
                </label>
                {family.children.map((c) => (
                  <label key={c.id} className="cursor-pointer rounded-full border px-3 py-1 text-sm" style={child === c.id ? { backgroundColor: c.color, borderColor: c.color, color: "#fff" } : { borderColor: c.color, color: c.color }}>
                    <input type="radio" name="child" value={c.id} checked={child === c.id} onChange={() => setChild(c.id)} className="sr-only" />
                    {c.name}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {error && (
            <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" className={BTN_PRIMARY} disabled={busy || preparing || (tab === "files" ? files.length === 0 : text.trim().length < 15)} onClick={() => submit(false)}>
              {busy ? t.add.working : t.add.submit}
            </button>
            <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={() => submit(true)}>
              {t.add.sample}
            </button>
            {busy && <span className="text-sm text-zinc-500" aria-live="polite">{t.add.working}</span>}
            {preparing && !busy && <span className="text-sm text-zinc-500" aria-live="polite">{t.add.preparing}</span>}
          </div>
          <p className="mt-6 text-xs text-zinc-500">
            <Link href={localePath(locale, "/privacy")} className="underline underline-offset-4">
              {t.nav.privacy}
            </Link>
          </p>
        </>
      )}
    </main>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiFailure, writeClipboard } from "@/lib/client";
import { useI18n } from "@/lib/i18n/context";
import { BTN_SMALL, INPUT } from "@/lib/ui";

const INTENTS = ["yes", "no", "absence", "question", "custom"] as const;
type Intent = (typeof INTENTS)[number];

// Drafts a message to the school about one item. The parent edits it here and copies
// it into e-mail, the school app or the reply slip; nothing is sent from ParentDesk.

export default function ReplyPanel({ itemId, onClose, initialIntent = "yes", initialNote = "", autoStart = false }: { itemId: string; onClose: () => void; initialIntent?: Intent; initialNote?: string; autoStart?: boolean }) {
  const { t } = useI18n();
  const [intent, setIntent] = useState<Intent>(initialIntent);
  const [note, setNote] = useState(initialNote);
  const started = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ reply: string; translation: string | null; subject: string | null } | null>(null);
  const [copied, setCopied] = useState(false);

  async function write() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.reply(itemId, intent, note);
      setDraft({ reply: res.reply, translation: res.translation, subject: res.subject });
    } catch (e) {
      const code = e instanceof ApiFailure ? e.code : "generic";
      const dict = t.add.errors as Record<string, string>;
      setError(code in dict && code !== "generic" ? dict[code] : t.reply.error);
    } finally {
      setBusy(false);
    }
  }

  // A question from the notice page arrives ready to send: draft it straight away.
  useEffect(() => {
    if (!autoStart || started.current) return;
    started.current = true;
    void write();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, []);

  async function copy() {
    if (!draft) return;
    const ok = await writeClipboard(draft.subject ? `${draft.subject}\n\n${draft.reply}` : draft.reply);
    setCopied(ok);
    setTimeout(() => setCopied(false), 2500);
  }

  return (
    <div className="mt-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm dark:border-zinc-800 dark:bg-zinc-950/40">
      <p className="font-semibold">{t.reply.title}</p>
      <label className="mt-2 grid gap-1">
        <span className="text-xs text-zinc-500">{t.reply.intent}</span>
        <select className={INPUT} value={intent} onChange={(e) => setIntent(e.target.value as Intent)}>
          {INTENTS.map((i) => (
            <option key={i} value={i}>
              {t.reply.intents[i]}
            </option>
          ))}
        </select>
      </label>
      <label className="mt-2 grid gap-1">
        <span className="text-xs text-zinc-500">{t.reply.note}</span>
        <textarea className={INPUT} rows={2} value={note} maxLength={600} placeholder={t.reply.notePlaceholder} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className={`${BTN_SMALL} border-indigo-600 text-indigo-700 dark:text-indigo-300`} disabled={busy || (intent === "custom" && note.trim().length < 3)} onClick={write}>
          {busy ? t.reply.working : t.reply.draft}
        </button>
        <button type="button" className={BTN_SMALL} onClick={onClose}>
          {t.common.close}
        </button>
      </div>
      {error && <p className="mt-2 text-red-600 dark:text-red-400">{error}</p>}
      {draft && (
        <div className="mt-3" aria-live="polite">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{t.reply.result}</p>
          {draft.subject && (
            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
              {t.reply.subject}: {draft.subject}
            </p>
          )}
          <textarea dir="auto" className={`${INPUT} mt-1`} rows={6} value={draft.reply} onChange={(e) => setDraft({ ...draft, reply: e.target.value })} />
          {draft.translation && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs font-medium">{t.reply.translation}</summary>
              <p dir="auto" className="mt-1 whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">{draft.translation}</p>
            </details>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={BTN_SMALL} onClick={copy}>
              {copied ? t.common.copied : t.common.copy}
            </button>
          </div>
          <p className="mt-2 text-xs text-zinc-500">{t.reply.disclaimer}</p>
        </div>
      )}
    </div>
  );
}

"use client";

import { useRef, useState } from "react";
import { api } from "@/lib/client";
import { useFamily } from "@/lib/family-context";
import { useI18n } from "@/lib/i18n/context";
import { fmt } from "@/lib/i18n";
import { BTN_SECONDARY } from "@/lib/ui";

// Download the family's list as a file; restore one into this family. Restoring only adds
// what is missing.

const CHUNK = 250; // items per request

export default function BackupCard() {
  const { t } = useI18n();
  const { setFamily } = useFamily();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const b = t.settings.backup;

  async function restore(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setNote(null);
    try {
      const data = JSON.parse(await file.text()) as { items?: unknown[]; sources?: unknown[] } & Record<string, unknown>;
      const all = Array.isArray(data.items) ? data.items : [];
      const idOf = (x: unknown) => (x as { id?: unknown } | null)?.id;
      // The whole backup has to fit before the first piece is sent.
      await api.importCheck(all.map(idOf), (Array.isArray(data.sources) ? data.sources : []).map(idOf));
      let items = 0;
      let sources = 0;
      for (let i = 0; i === 0 || i < all.length; i += CHUNK) {
        const res = await api.importBackup(JSON.stringify({ ...data, items: all.slice(i, i + CHUNK) }));
        setFamily(res.family);
        items += res.restored.items;
        sources += res.restored.sources;
      }
      setNote({ ok: true, text: fmt(b.restored, { items, sources }) });
    } catch {
      setNote({ ok: false, text: b.error });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div id="backup">
      <h3 className="mt-5 text-sm font-semibold">{b.title}</h3>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{b.body}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <a href="/api/family/export" className={BTN_SECONDARY} download>
          {b.download}
        </a>
        <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={() => input.current?.click()}>
          {b.restore}
        </button>
        <input ref={input} type="file" accept="application/json,.json" className="hidden" onChange={(e) => void restore(e.target.files?.[0])} />
      </div>
      {note && (
        <p className={`mt-2 text-sm ${note.ok ? "text-emerald-700 dark:text-emerald-300" : "text-red-600 dark:text-red-400"}`} role="status">
          {note.text}
        </p>
      )}
    </div>
  );
}

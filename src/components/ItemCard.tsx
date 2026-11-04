"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { LOCALE_TAGS } from "@/lib/i18n/locales";
import { fmt } from "@/lib/i18n";
import { daysBetween, formatDate, formatMoney, formatTime, todayIn } from "@/lib/dates";
import { downloadIcs, googleCalendarUrl, type FeedItem, type FeedLabels } from "@/lib/ics";
import { ITEM_TYPES, type ItemType } from "@/lib/schema";
import type { Child, Item } from "@/lib/store";
import { BTN_SMALL, INPUT, TYPE_STYLES } from "@/lib/ui";
import ChildChips from "./ChildChips";

type Patch = Partial<Item> & Record<string, unknown>;

export default function ItemCard({
  item,
  childrenList,
  timezone,
  onPatch,
  onRemove,
}: {
  item: Item;
  childrenList: Child[];
  timezone: string;
  onPatch: (id: string, patch: Patch) => Promise<void>;
  onRemove?: (id: string) => Promise<void>;
}) {
  const { locale, t } = useI18n();
  const tag = LOCALE_TAGS[locale];
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showQuote, setShowQuote] = useState(false);
  const [draft, setDraft] = useState<Patch>({});

  const todayIso = todayIn(timezone);
  const diff = item.date ? daysBetween(todayIso, item.date) : null;
  const muted = item.status !== "open";
  const labels: FeedLabels = { deadline: t.item.types.deadline, todo: t.item.types.todo, payment: t.item.types.payment, consent: t.item.types.consent, bring: t.item.bring };
  const feedItem: FeedItem = {
    ...item,
    childNames: childrenList.filter((c) => item.childIds.includes(c.id)).map((c) => c.name),
  };

  async function run(p: Patch) {
    setBusy(true);
    try {
      await onPatch(item.id, p);
    } finally {
      setBusy(false);
    }
  }

  function relative(): string {
    if (diff === null) return "";
    if (diff === 0) return t.home.buckets.today;
    if (diff === 1) return t.home.buckets.tomorrow;
    if (diff > 1) return fmt(t.home.inDays, { n: diff });
    return fmt(t.home.daysAgo, { n: -diff });
  }

  const when = item.date ? `${formatDate(item.date, tag)}${item.end_date && item.end_date !== item.date ? ` – ${formatDate(item.end_date, tag)}` : ""}` : "";
  const clock = item.time ? `${formatTime(item.time, tag)}${item.end_time ? ` – ${formatTime(item.end_time, tag)}` : ""}` : "";
  const actionable = item.type !== "event" && item.type !== "info";

  return (
    <article className={`rounded-2xl border bg-white p-4 shadow-sm dark:bg-zinc-900 ${muted ? "border-zinc-200 opacity-60 dark:border-zinc-800" : "border-zinc-200 dark:border-zinc-800"}`}>
      <div className="flex items-start gap-3">
        <span className={`mt-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full ${TYPE_STYLES[item.type].dot}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span className={`rounded-full px-2 py-0.5 font-medium ${TYPE_STYLES[item.type].badge}`}>{t.item.types[item.type]}</span>
            {item.date && (
              <span className={`font-medium ${diff !== null && diff < 0 && item.status === "open" ? "text-red-600 dark:text-red-400" : "text-zinc-700 dark:text-zinc-300"}`}>
                {actionable ? `${t.item.due} ` : ""}
                {when}
                {clock ? ` · ${clock}` : ""}
                {diff !== null && Math.abs(diff) <= 14 ? ` · ${relative()}` : ""}
              </span>
            )}
            {item.status !== "open" && <span className="text-zinc-500">{t.item.status[item.status]}</span>}
          </div>
          <h3 className={`mt-1 text-base font-semibold ${muted ? "line-through" : ""}`}>{item.title}</h3>
          <div className="mt-1">
            <ChildChips childrenList={childrenList} ids={item.childIds} emptyLabel={childrenList.length ? t.item.noChild : undefined} />
          </div>
          {item.description && <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">{item.description}</p>}
          {item.action_text && <p className="mt-1 text-sm font-medium">→ {item.action_text}</p>}
          {item.amount !== null && <p className="mt-1 text-sm font-semibold">{formatMoney(item.amount, item.currency, tag)}</p>}
          {item.location && <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">📍 {item.location}</p>}
          {item.bring.length > 0 && (
            <p className="mt-1 text-sm">
              <span className="font-medium">{t.item.bring}:</span> {item.bring.join(", ")}
            </p>
          )}
          {item.confidence !== "high" && t.item.confidence[item.confidence] && (
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">⚠ {t.item.confidence[item.confidence]}</p>
          )}
          {item.quote && (
            <p className="mt-1 text-xs text-zinc-500">
              <button type="button" className="underline underline-offset-2" onClick={() => setShowQuote((s) => !s)}>
                {t.item.quote}
              </button>
              {showQuote && <span className="ml-1 italic">“{item.quote}”</span>}
            </p>
          )}

          {!editing && (
            <div className="no-print mt-3 flex flex-wrap gap-2">
              {item.status === "open" ? (
                <button type="button" disabled={busy} className={`${BTN_SMALL} border-emerald-600 text-emerald-700 dark:text-emerald-300`} onClick={() => run({ status: "done" })}>
                  ✓ {t.item.done}
                </button>
              ) : (
                <button type="button" disabled={busy} className={BTN_SMALL} onClick={() => run({ status: "open" })}>
                  {item.status === "done" ? t.item.undo : t.item.restore}
                </button>
              )}
              {item.status === "open" && (
                <button type="button" disabled={busy} className={BTN_SMALL} onClick={() => run({ status: "dismissed" })}>
                  {t.item.dismiss}
                </button>
              )}
              {item.date && (
                <>
                  <a href={googleCalendarUrl(feedItem, labels)} target="_blank" rel="noopener noreferrer" className={BTN_SMALL}>
                    {t.item.googleCalendar}
                  </a>
                  <button type="button" className={BTN_SMALL} onClick={() => downloadIcs(feedItem, labels)}>
                    {t.item.downloadIcs}
                  </button>
                </>
              )}
              <button
                type="button"
                className={BTN_SMALL}
                onClick={() => {
                  setDraft({ title: item.title, type: item.type, date: item.date, time: item.time, description: item.description, location: item.location, amount: item.amount, childIds: item.childIds });
                  setEditing(true);
                }}
              >
                {t.item.edit}
              </button>
              {onRemove && (
                <button type="button" disabled={busy} className={`${BTN_SMALL} text-red-600 dark:text-red-400`} onClick={() => onRemove(item.id)}>
                  {t.item.delete}
                </button>
              )}
            </div>
          )}

          {editing && (
            <form
              className="mt-3 grid gap-2 text-sm"
              onSubmit={async (e) => {
                e.preventDefault();
                await run({
                  ...draft,
                  amount: draft.amount === null || draft.amount === undefined || draft.amount === ("" as unknown) ? null : Number(draft.amount),
                  time: draft.time || null,
                  date: draft.date || null,
                });
                setEditing(false);
              }}
            >
              <label className="grid gap-1">
                <span className="text-xs text-zinc-500">{t.item.fieldTitle}</span>
                <input className={INPUT} value={String(draft.title ?? "")} onChange={(e) => setDraft({ ...draft, title: e.target.value })} required />
              </label>
              <div className="grid grid-cols-3 gap-2">
                <label className="grid gap-1">
                  <span className="text-xs text-zinc-500">{t.item.fieldType}</span>
                  <select className={INPUT} value={String(draft.type ?? item.type)} onChange={(e) => setDraft({ ...draft, type: e.target.value as ItemType })}>
                    {ITEM_TYPES.map((ty) => (
                      <option key={ty} value={ty}>
                        {t.item.types[ty]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1">
                  <span className="text-xs text-zinc-500">{t.item.fieldDate}</span>
                  <input type="date" className={INPUT} value={String(draft.date ?? "")} onChange={(e) => setDraft({ ...draft, date: e.target.value || null })} />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs text-zinc-500">{t.item.fieldTime}</span>
                  <input type="time" className={INPUT} value={String(draft.time ?? "")} onChange={(e) => setDraft({ ...draft, time: e.target.value || null })} />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="grid gap-1">
                  <span className="text-xs text-zinc-500">{t.item.fieldAmount}</span>
                  <input type="number" step="0.01" className={INPUT} value={draft.amount === null || draft.amount === undefined ? "" : String(draft.amount)} onChange={(e) => setDraft({ ...draft, amount: e.target.value === "" ? null : Number(e.target.value) })} />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs text-zinc-500">{t.item.fieldLocation}</span>
                  <input className={INPUT} value={String(draft.location ?? "")} onChange={(e) => setDraft({ ...draft, location: e.target.value })} />
                </label>
              </div>
              <label className="grid gap-1">
                <span className="text-xs text-zinc-500">{t.item.fieldNotes}</span>
                <textarea className={INPUT} rows={2} value={String(draft.description ?? "")} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              </label>
              {childrenList.length > 0 && (
                <div className="grid gap-1">
                  <span className="text-xs text-zinc-500">{t.item.fieldChildren}</span>
                  <ChildChips
                    childrenList={childrenList}
                    selected={(draft.childIds as string[]) ?? []}
                    onToggle={(id) => {
                      const cur = (draft.childIds as string[]) ?? [];
                      setDraft({ ...draft, childIds: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
                    }}
                  />
                </div>
              )}
              <div className="flex gap-2">
                <button type="submit" disabled={busy} className={`${BTN_SMALL} border-indigo-600 text-indigo-700 dark:text-indigo-300`}>
                  {t.item.save}
                </button>
                <button type="button" className={BTN_SMALL} onClick={() => setEditing(false)}>
                  {t.item.cancel}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </article>
  );
}

import { ITEM_TYPES } from "./schema";
import { MAX_ITEMS, MAX_SOURCES, newId } from "./store";
import { CHILD_COLORS, MAX_CHILDREN, RECURRENCES, type Child, type FamilyRecord, type Item, type Source, type SourceKind } from "./types";

// A family's own copy of its list. There are no accounts, so a lost key means a lost
// family: the backup file is the way back. It holds what the parent already sees (children,
// notices, items) and nothing that opens anything (no keys, feed or hook secrets, tokens).

export const BACKUP_FORMAT = "parentdesk-backup";

export type Backup = { format: typeof BACKUP_FORMAT; version: 1; exportedAt: string; familyName: string; children: Child[]; sources: Source[]; items: Item[] };

export function exportBackup(rec: FamilyRecord, now: string = new Date().toISOString()): Backup {
  return { format: BACKUP_FORMAT, version: 1, exportedAt: now, familyName: rec.settings.familyName, children: rec.children, sources: rec.sources, items: rec.items };
}

const str = (x: unknown, max: number): string => (typeof x === "string" ? x.slice(0, max) : "");
const strOrNull = (x: unknown, max: number): string | null => (typeof x === "string" && x ? x.slice(0, max) : null);
// A real calendar day and a real time of day, not just the shape.
const isoDate = (x: unknown): string | null => {
  if (typeof x !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(x)) return null;
  const d = new Date(`${x}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === x ? x : null;
};
const clock = (x: unknown): string | null => (typeof x === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(x) ? x : null);
const stamp = (x: unknown, fallback: string): string => (typeof x === "string" && !Number.isNaN(Date.parse(x)) ? new Date(x).toISOString() : fallback);
const KINDS: SourceKind[] = ["upload", "paste", "email", "sample", "share", "gmail", "room", "hook"];

export type ImportResult = { ok: true; children: number; sources: number; items: number } | { ok: false; reason: "bad_format" | "too_many" };
export type ImportLimits = { children: number; items: number; sources: number };

// Merges a backup into a family: children are matched by name (new ones added up to the
// limit), notices and items that are already there (same id) are left alone, everything
// else is added with its fields checked one by one. Nothing is removed.
// Would a whole backup fit? Asked once before a restore that goes up in pieces, so a
// restore is refused before anything is written rather than half way through.
export function backupFits(rec: FamilyRecord, itemIds: unknown, sourceIds: unknown, limits: { items: number; sources: number } = { items: MAX_ITEMS, sources: MAX_SOURCES }): boolean {
  const fresh = (ids: unknown, have: Set<string>) => (Array.isArray(ids) ? new Set(ids.filter((x): x is string => typeof x === "string" && !have.has(x))).size : 0);
  const items = rec.items.length + fresh(itemIds, new Set(rec.items.map((i) => i.id)));
  const sources = rec.sources.length + fresh(sourceIds, new Set(rec.sources.map((s) => s.id)));
  return items <= limits.items && sources <= limits.sources;
}

// When the result would not fit (the store keeps a limited number of items and notices and
// would drop the oldest), nothing is changed and the restore is refused.
export function importBackup(target: FamilyRecord, data: unknown, limits: ImportLimits = { children: MAX_CHILDREN, items: MAX_ITEMS, sources: MAX_SOURCES }, now: string = new Date().toISOString()): ImportResult {
  const b = data as Partial<Backup> | null;
  if (!b || typeof b !== "object" || b.format !== BACKUP_FORMAT || !Array.isArray(b.children) || !Array.isArray(b.sources) || !Array.isArray(b.items)) return { ok: false, reason: "bad_format" };
  // Work on copies; the family is touched only when everything fits.
  const rec = { settings: target.settings, children: [...target.children], sources: [...target.sources], items: [...target.items] };
  const maxChildren = limits.children;

  const childMap = new Map<string, string>();
  let children = 0;
  for (const raw of b.children.slice(0, MAX_CHILDREN)) {
    const c = raw as Partial<Child> | null;
    const name = str(c?.name, 40).trim();
    if (!c || !name || typeof c.id !== "string") continue;
    let mine = rec.children.find((x) => x.name.trim().toLowerCase() === name.toLowerCase());
    if (!mine && rec.children.length < Math.min(maxChildren, MAX_CHILDREN)) {
      mine = { id: newId(4), name, color: typeof c.color === "string" && /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : CHILD_COLORS[rec.children.length % CHILD_COLORS.length] };
      rec.children.push(mine);
      children++;
    }
    if (mine) childMap.set(c.id, mine.id);
  }

  const haveSource = new Set(rec.sources.map((s) => s.id));
  let sources = 0;
  for (const raw of b.sources.slice(0, MAX_SOURCES)) {
    const s = raw as Partial<Source> | null;
    if (!s || typeof s.id !== "string" || !/^[0-9a-f]{6,16}$/.test(s.id)) continue;
    if (haveSource.has(s.id)) continue;
    rec.sources.push({
      id: s.id,
      ts: stamp(s.ts, now),
      kind: KINDS.includes(s.kind as SourceKind) ? (s.kind as SourceKind) : "upload",
      title: str(s.title, 160),
      sender: str(s.sender, 120),
      summary: str(s.summary, 1200),
      language: str(s.language, 12) || rec.settings.language,
      pages: typeof s.pages === "number" && s.pages > 0 && s.pages < 100 ? Math.round(s.pages) : 1,
      questions: Array.isArray(s.questions) ? s.questions.filter((q): q is string => typeof q === "string").slice(0, 8).map((q) => q.slice(0, 300)) : [],
    });
    haveSource.add(s.id);
    sources++;
  }

  const haveItem = new Set(rec.items.map((i) => i.id));
  let items = 0;
  for (const raw of b.items.slice(0, MAX_ITEMS)) {
    const it = raw as Partial<Item> | null;
    if (!it || typeof it.id !== "string" || !/^[0-9a-f]{6,16}$/.test(it.id) || haveItem.has(it.id)) continue;
    // The notice itself may be gone (the store keeps fewer notices than items): the item still counts.
    if (typeof it.sourceId !== "string" || !/^[0-9a-f]{6,16}$/.test(it.sourceId)) continue;
    const title = str(it.title, 200).trim();
    if (!title || !ITEM_TYPES.includes(it.type as (typeof ITEM_TYPES)[number])) continue;
    const item: Item = {
      id: it.id,
      sourceId: it.sourceId,
      type: it.type as Item["type"],
      title,
      description: str(it.description, 1000),
      date: isoDate(it.date),
      end_date: isoDate(it.end_date),
      time: clock(it.time),
      end_time: clock(it.end_time),
      all_day: it.all_day !== false,
      location: strOrNull(it.location, 200),
      amount: typeof it.amount === "number" && Number.isFinite(it.amount) && it.amount >= 0 ? it.amount : null,
      currency: typeof it.currency === "string" && /^[A-Z]{3}$/.test(it.currency) ? it.currency : null,
      bring: Array.isArray(it.bring) ? it.bring.filter((x): x is string => typeof x === "string").slice(0, 20).map((x) => x.slice(0, 80)) : [],
      requires_action: it.requires_action === true,
      action_text: strOrNull(it.action_text, 300),
      confidence: it.confidence === "low" || it.confidence === "medium" ? it.confidence : "high",
      quote: strOrNull(it.quote, 400),
      childIds: Array.isArray(it.childIds) ? [...new Set(it.childIds.map((id) => childMap.get(id as string)).filter((id): id is string => Boolean(id)))] : [],
      status: it.status === "done" || it.status === "dismissed" ? it.status : "open",
      createdAt: stamp(it.createdAt, now),
      updatedAt: stamp(it.updatedAt, now),
    };
    if (RECURRENCES.includes(it.recurrence as (typeof RECURRENCES)[number])) item.recurrence = it.recurrence;
    if (typeof it.owner === "string" && rec.settings.members.includes(it.owner)) item.owner = it.owner;
    rec.items.push(item);
    haveItem.add(item.id);
    items++;
  }
  if (rec.items.length > limits.items || rec.sources.length > limits.sources) return { ok: false, reason: "too_many" };
  target.children = rec.children;
  target.sources = rec.sources;
  target.items = rec.items;
  return { ok: true, children, sources, items };
}

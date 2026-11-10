import { listDocIds, newId, readDoc, readOps, removeDoc, writeDoc, writeOps } from "./store";

// Last runs of the scheduled jobs, kept next to the families for the admin page.

export type Run = { at: string; ms: number; summary: Record<string, unknown> };
export type Runs = Record<string, Run[]>;

const KEEP = 20;

export async function recordRun(name: string, ms: number, summary: Record<string, unknown>): Promise<void> {
  const runs = (await readOps<Runs>("runs")) ?? {};
  runs[name] = [{ at: new Date().toISOString(), ms, summary }, ...(runs[name] ?? [])].slice(0, KEEP);
  await writeOps("runs", runs);
}

// What the operator did in the console (deletes, unlisting, clean-ups), newest first.
export type AdminAction = { at: string; action: string; target: string; note: string; by?: string };

// One small document per action (adminlog/<id>), so two actions at once never lose one.
const ADMIN_LOG = "adminlog/";
const KEEP_ACTIONS = 200;

export async function recordAdminAction(action: string, target: string, note = "", by = ""): Promise<void> {
  const entry: AdminAction = { at: new Date().toISOString(), action, target, note, by };
  await writeDoc(`${ADMIN_LOG}${newId(6)}`, JSON.stringify(entry));
}

// Newest first; entries beyond the last couple of hundred are cleared on the way.
export async function readAdminActions(limit = 50): Promise<AdminAction[]> {
  const ids = await listDocIds(ADMIN_LOG);
  const all = (
    await Promise.all(
      ids.map(async (id) => {
        try {
          const raw = await readDoc(`${ADMIN_LOG}${id}`);
          const e = raw ? (JSON.parse(raw) as AdminAction) : null;
          return e && typeof e.at === "string" ? { id, e } : null;
        } catch {
          return null;
        }
      }),
    )
  )
    .filter((x): x is { id: string; e: AdminAction } => x !== null)
    .sort((a, b) => (a.e.at < b.e.at ? 1 : -1));
  for (const old of all.slice(KEEP_ACTIONS)) await removeDoc(`${ADMIN_LOG}${old.id}`).catch(() => undefined);
  return all.slice(0, limit).map((x) => x.e);
}

// The operator's announcement: one at a time, for teachers, families or both, until a date.
export type AnnouncementDoc = { id: string; text: string; texts?: Record<string, string>; audience: "teachers" | "families" | "all"; until: string; at: string };

export async function setAnnouncement(text: string, audience: AnnouncementDoc["audience"], days: number, texts?: Record<string, string>): Promise<AnnouncementDoc | null> {
  const clean = text.replace(/\s+\n/g, "\n").trim().slice(0, 500);
  if (!clean) {
    await writeOps("announcement", null);
    return null;
  }
  const now = new Date();
  const doc: AnnouncementDoc = { id: newId(4), text: clean, ...(texts ? { texts } : {}), audience, until: new Date(now.getTime() + Math.min(60, Math.max(1, days)) * 86400000).toISOString(), at: now.toISOString() };
  await writeOps("announcement", doc);
  return doc;
}

export async function readAnnouncement(): Promise<AnnouncementDoc | null> {
  const doc = await readOps<AnnouncementDoc | null>("announcement");
  return doc && typeof doc.text === "string" && typeof doc.until === "string" ? doc : null;
}

export async function activeAnnouncement(who: "teachers" | "families", now: Date = new Date()): Promise<AnnouncementDoc | null> {
  const doc = await readAnnouncement();
  if (!doc || doc.until < now.toISOString()) return null;
  return doc.audience === "all" || doc.audience === who ? doc : null;
}

// The operator's note and pause switch for one family, in a document of their own
// (familyadmin/<family id>): a family save that was already under way cannot wipe them.
export type FamilyAdmin = { note: string; blocked: boolean };
const FAMILY_ADMIN = "familyadmin/";

// No document means "nothing set". A document that cannot be read or parsed is an error and
// is passed on: guessing "not paused" would let a paused family through, and a save on top
// of a guess would wipe the real state.
export async function readFamilyAdmin(id: string): Promise<FamilyAdmin> {
  const raw = await readDoc(`${FAMILY_ADMIN}${id}`);
  if (raw === null) return { note: "", blocked: false };
  const a = JSON.parse(raw) as Partial<FamilyAdmin> | null;
  if (!a || typeof a !== "object" || typeof a.note !== "string" || typeof a.blocked !== "boolean") throw new Error(`familyadmin/${id} is damaged`);
  return { note: a.note, blocked: a.blocked };
}

export async function writeFamilyAdmin(id: string, patch: Partial<FamilyAdmin>): Promise<FamilyAdmin> {
  const next = { ...(await readFamilyAdmin(id)), ...patch };
  if (!next.note && !next.blocked) await removeDoc(`${FAMILY_ADMIN}${id}`); // an error is passed on, as above
  else await writeDoc(`${FAMILY_ADMIN}${id}`, JSON.stringify(next));
  return next;
}

export async function removeFamilyAdmin(id: string): Promise<void> {
  await removeDoc(`${FAMILY_ADMIN}${id}`);
}

// Paused families may read their list but not spend model calls.
export async function isPaused(id: string): Promise<boolean> {
  return (await readFamilyAdmin(id)).blocked;
}

// The announcement's text for one UI language (the original when there is no translation).
export function announcementText(doc: AnnouncementDoc, locale: string | null | undefined): string {
  const t = locale ? doc.texts?.[locale] : undefined;
  return typeof t === "string" && t.trim() ? t : doc.text;
}

// ---- pausing a teacher desk ----
// Same idea as a family's pause, in a document of its own (teacheradmin/<teacher id>).
const TEACHER_ADMIN = "teacheradmin/";

export async function isTeacherPaused(id: string): Promise<boolean> {
  const raw = await readDoc(`${TEACHER_ADMIN}${id}`);
  if (raw === null) return false;
  const a = JSON.parse(raw) as { blocked?: unknown } | null;
  if (!a || typeof a !== "object" || typeof a.blocked !== "boolean") throw new Error(`teacheradmin/${id} is damaged`);
  return a.blocked;
}

export async function setTeacherPaused(id: string, blocked: boolean): Promise<void> {
  // A failed write or removal is passed on: the caller must not report (or log) a change that did not happen.
  if (blocked) await writeDoc(`${TEACHER_ADMIN}${id}`, JSON.stringify({ blocked: true }));
  else await removeDoc(`${TEACHER_ADMIN}${id}`);
}

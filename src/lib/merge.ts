import type { Billing, Child, DigestState, FamilyRecord, GmailLink, Invite, Item, PushSub, RoomSubscription, Settings, Source } from "./types";

// Conflict-safe merge for the one-JSON-per-family store (lib/store.ts). There are no
// accounts, so two phones in the same family (a parent and their partner, several devices)
// each load the family document, change it, and write the whole thing back. Without this,
// the later write wins and the other phone's change — a notice just added, a setting just
// changed — is lost.
//
// When saveFamily sees that the stored document moved on since this request loaded it, it
// replays THIS request's change onto the latest stored version instead of overwriting it.
// That needs three versions: `base` (what this request loaded), `mine` (base + this
// request's change) and `theirs` (what is on disk now). The merge keeps both sides' work:
// additions from either, the newer edit of a shared row, both sides' field changes, and the
// sum of concurrent counter increments. A delete loses to a concurrent edit (the row comes
// back) rather than silently dropping the other phone's work.
//
// This is a heuristic, not a CRDT: two edits to the very same field in the very same
// instant resolve to one of them. For a family's handful of devices, writing seconds or
// minutes apart, it removes the data loss that mattered.

// Equal by value for the plain JSON these records hold. Good enough to tell "I changed this
// row" from "I left it alone"; the fields are built by the same code paths, so key order is
// stable.
function eq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

// Rows with an id and an `updatedAt` (items): newest edit wins; a delete yields to a
// concurrent edit. `base` is the row as this request first loaded it.
function mergeStamped<T extends { updatedAt: string }>(base: T[], mine: T[], theirs: T[], key: (x: T) => string): T[] {
  const b = new Map(base.map((x) => [key(x), x]));
  const m = new Map(mine.map((x) => [key(x), x]));
  const t = new Map(theirs.map((x) => [key(x), x]));
  const out: T[] = [];
  for (const k of new Set([...m.keys(), ...t.keys()])) {
    const mi = m.get(k);
    const ti = t.get(k);
    const bi = b.get(k);
    if (mi && ti) out.push(ti.updatedAt > mi.updatedAt ? ti : mi); // tie keeps mine
    else if (mi) {
      if (!bi) out.push(mi); // I added it
      else if (mi.updatedAt > bi.updatedAt) out.push(mi); // they deleted, I edited: keep the edit
      // else: honour their delete
    } else if (ti) {
      if (!bi) out.push(ti); // they added it
      else if (ti.updatedAt > bi.updatedAt) out.push(ti); // I deleted, they edited: keep the edit
      // else: honour my delete
    }
  }
  return out;
}

// Rows with an id but no timestamp (children, room subscriptions): "changed" means the row
// differs from `base`. A delete yields to a concurrent edit. Order follows mine, then any
// rows only the other side has.
function mergeKeyed<T>(base: T[], mine: T[], theirs: T[], key: (x: T) => string): T[] {
  const b = new Map(base.map((x) => [key(x), x]));
  const m = new Map(mine.map((x) => [key(x), x]));
  const t = new Map(theirs.map((x) => [key(x), x]));
  const pick = (k: string): T | undefined => {
    const mi = m.get(k);
    const ti = t.get(k);
    const bi = b.get(k);
    if (mi && ti) return eq(mi, bi) ? ti : mi; // I left it alone -> theirs; else my edit
    if (mi) return !bi || !eq(mi, bi) ? mi : undefined; // added, or my edit beats their delete
    if (ti) return !bi || !eq(ti, bi) ? ti : undefined; // added, or their edit beats my delete
    return undefined;
  };
  const out: T[] = [];
  const done = new Set<string>();
  for (const x of [...mine, ...theirs]) {
    const k = key(x);
    if (done.has(k)) continue;
    done.add(k);
    const r = pick(k);
    if (r) out.push(r);
  }
  return out;
}

// Append-only rows that are never edited in place (notices and their push devices): keep
// everything either side still has, drop only what a side deliberately removed.
function mergeUnion<T>(base: T[], mine: T[], theirs: T[], key: (x: T) => string): T[] {
  const mk = new Set(mine.map(key));
  const tk = new Set(theirs.map(key));
  const removed = new Set<string>();
  for (const x of base) {
    const k = key(x);
    if (!mk.has(k) || !tk.has(k)) removed.add(k); // a side dropped it on purpose
  }
  const out: T[] = [];
  const done = new Set<string>();
  for (const x of [...mine, ...theirs]) {
    const k = key(x);
    if (removed.has(k) || done.has(k)) continue;
    done.add(k);
    out.push(x);
  }
  return out;
}

// Monthly usage and lifetime counters: concurrent increments add up, so the result is
// theirs plus whatever this request added since it loaded.
function mergeCounts(base: Record<string, number> = {}, mine: Record<string, number> = {}, theirs: Record<string, number> = {}): Record<string, number> {
  const out: Record<string, number> = { ...theirs };
  for (const k of new Set([...Object.keys(base), ...Object.keys(mine), ...Object.keys(theirs)])) {
    const v = (theirs[k] ?? 0) + ((mine[k] ?? 0) - (base[k] ?? 0));
    out[k] = v > 0 ? v : 0;
  }
  return out;
}

// Each setting is independent: keep my change to a field, otherwise take theirs. Two phones
// changing different settings both stick.
function mergeSettings(base: Settings, mine: Settings, theirs: Settings): Settings {
  const out: Settings = { ...theirs };
  for (const k of Object.keys(mine) as (keyof Settings)[]) {
    if (!eq(mine[k], base[k])) (out as Record<string, unknown>)[k] = mine[k];
  }
  return out;
}

// Invite links: keep every live link from either side, and the higher use count for a link
// both sides have, so a use is never uncounted.
function mergeInvites(mine: Invite[] = [], theirs: Invite[] = []): Invite[] {
  const map = new Map<string, Invite>();
  for (const inv of [...theirs, ...mine]) {
    const ex = map.get(inv.hash);
    map.set(inv.hash, ex ? { ...inv, uses: Math.max(ex.uses, inv.uses) } : inv);
  }
  return [...map.values()];
}

export function mergeFamily(base: FamilyRecord, mine: FamilyRecord, theirs: FamilyRecord): FamilyRecord {
  // A single field changed by this request wins; otherwise the latest stored value stands.
  const pick = <K extends keyof FamilyRecord>(k: K): FamilyRecord[K] => (eq(mine[k], base[k]) ? theirs[k] : mine[k]);
  return {
    ...theirs, // start from the latest stored version so nothing unhandled is dropped
    id: theirs.id,
    keyHash: theirs.keyHash,
    createdAt: theirs.createdAt,
    memberHashes: [...new Set([...(theirs.memberHashes ?? []), ...(mine.memberHashes ?? [])])].slice(-10),
    feedSecret: pick("feedSecret") as string,
    hookSecret: pick("hookSecret") as string,
    inboundCode: pick("inboundCode") as string,
    settings: mergeSettings(base.settings, mine.settings, theirs.settings),
    children: mergeKeyed<Child>(base.children, mine.children, theirs.children, (c) => c.id),
    sources: mergeUnion<Source>(base.sources, mine.sources, theirs.sources, (s) => s.id),
    items: mergeStamped<Item>(base.items, mine.items, theirs.items, (i) => i.id),
    usage: mergeCounts(base.usage, mine.usage, theirs.usage),
    counters: mergeCounts(base.counters, mine.counters, theirs.counters),
    invites: mergeInvites(mine.invites, theirs.invites),
    rooms: mergeKeyed<RoomSubscription>(base.rooms ?? [], mine.rooms ?? [], theirs.rooms ?? [], (r) => r.roomId),
    push: mergeUnion<PushSub>(base.push ?? [], mine.push ?? [], theirs.push ?? [], (p) => p.endpoint),
    gmail: pick("gmail") as GmailLink | null | undefined,
    billing: pick("billing") as Billing | null | undefined,
    digest: pick("digest") as DigestState | null | undefined,
  };
}

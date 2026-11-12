import { createHmac, randomBytes } from "node:crypto";
import { after } from "next/server";
import { addMark, listMarks, removeMark, storageMode, sweepMarks, wipeMarks } from "./store";

// Two layers.
//
// 1. Memory: counters inside this server instance. Instant, free, and gone when the
//    instance is replaced. On its own it only stops a runaway client.
// 2. Storage: the same caps counted in the family store, so they hold across instances
//    and restarts. Every counted request adds one tiny entry ("mark") to a bucket named
//    after the key and the current hour (or day) and, once the entry is written, lists
//    the bucket: the request is allowed when fewer than `cap` other entries are there.
//    Whoever writes the entry that takes a bucket past its cap sees that when it looks,
//    whatever order the requests started in, so requests sent side by side can be let
//    through short but never over. Nothing is ever rewritten, so two instances cannot
//    lose each other's counts; a refused request takes its entry away again. When the
//    store cannot be reached the request is refused: a cap nobody can count is not a cap.
//    (This relies on the store listing an entry once its write has returned.)
//
// Buckets of hours and days that are over are removed by the daily job and, in case that
// job is not set up, by the first counted request of every six hours (`sweepLimiter`).
//
// Locally (files under LOCAL_DATA_DIR) the stored counters are emptied when the server
// starts (src/instrumentation.ts), so a restarted dev server counts afresh.
//
// The memory layer is asked first, so an instance that already knows a key is over its
// cap answers without touching storage. It counts only what was let through: a request
// the store refuses (or cannot count) is taken off the memory counters again.
//
// Keys: the family id (primary, so one busy family cannot block another on the same
// network), the client IP (a backstop, and the only key before a family exists), and a
// global daily cap. Addresses are never stored as such: a bucket name is a keyed hash.
//
// The class-directory lookups (`allowLookup`) stay in memory only: they are cheap reads
// and a stored count would cost more than the search it guards.

const HOURLY_CAP_PER_FAMILY = Number(process.env.HOURLY_CAP_PER_FAMILY ?? 20);
const HOURLY_CAP_PER_IP = Number(process.env.HOURLY_CAP_PER_IP ?? 60);
const DAILY_CAP = Number(process.env.DAILY_CAP ?? 500);
const HOURLY_LOOKUPS_PER_IP = Number(process.env.HOURLY_LOOKUPS_PER_IP ?? 120);

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const SWEEP_EVERY = 6 * HOUR;

type Window = { windowStart: number; count: number };
const buckets = new Map<string, Window>();
let daily = { day: "", count: 0 };
// Stored buckets this instance has just seen full, and until when it answers for them
// without asking again. Short on purpose: "full" may have been other requests' entries
// that were taken away a moment later.
const FULL_FOR = 15 * 1000;
const full = new Map<string, number>();
function isFull(bucket: string, now: number): boolean {
  const until = full.get(bucket);
  if (until === undefined) return false;
  if (until > now) return true;
  full.delete(bucket);
  return false;
}
let sweepChecked = -1;

export type Gate = { ok: true } | { ok: false; reason: "rate_limited" | "daily_cap"; retryAfterSec: number };

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function secondsToUtcMidnight(): number {
  const now = Date.now();
  const next = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + 1);
  return Math.max(60, Math.round((next - now) / 1000));
}

function secondsToNextHour(now: number): number {
  return Math.max(1, Math.ceil(((Math.floor(now / HOUR) + 1) * HOUR - now) / 1000));
}

// ---- memory layer ----

function check(key: string, cap: number, now: number): { ok: boolean; retryAfterSec: number } {
  const w = buckets.get(key);
  if (!w || now - w.windowStart > HOUR) return { ok: true, retryAfterSec: 0 };
  if (w.count >= cap) return { ok: false, retryAfterSec: Math.ceil((w.windowStart + HOUR - now) / 1000) };
  return { ok: true, retryAfterSec: 0 };
}

function bump(key: string, now: number) {
  const w = buckets.get(key);
  if (!w || now - w.windowStart > HOUR) buckets.set(key, { windowStart: now, count: 1 });
  else w.count += 1;
}

function unbump(key: string) {
  const w = buckets.get(key);
  if (w && w.count > 0) w.count -= 1;
}

// A request the memory layer let through and the store did not: it counts nowhere.
function forgetRequest(keys: { ip: string; family: string | null }) {
  unbump(`ip:${keys.ip}`);
  if (keys.family) unbump(`f:${keys.family}`);
  if (daily.count > 0) daily.count -= 1;
}

function prune(now: number) {
  if (buckets.size > 10000) {
    for (const [k, v] of buckets) if (now - v.windowStart > HOUR) buckets.delete(k);
  }
  if (full.size > 5000) full.clear();
}

function localOne(key: string, cap: number, now: number): Gate {
  const g = check(key, cap, now);
  if (!g.ok) return { ok: false, reason: "rate_limited", retryAfterSec: g.retryAfterSec };
  bump(key, now);
  prune(now);
  return { ok: true };
}

function localRequest(keys: { ip: string; family: string | null }, now: number): Gate {
  const day = todayUtc();
  if (daily.day !== day) daily = { day, count: 0 };
  if (daily.count >= DAILY_CAP) return { ok: false, reason: "daily_cap", retryAfterSec: secondsToUtcMidnight() };

  const ipKey = `ip:${keys.ip}`;
  const ipGate = check(ipKey, HOURLY_CAP_PER_IP, now);
  if (!ipGate.ok) return { ok: false, reason: "rate_limited", retryAfterSec: ipGate.retryAfterSec };

  const famKey = keys.family ? `f:${keys.family}` : null;
  if (famKey) {
    const g = check(famKey, HOURLY_CAP_PER_FAMILY, now);
    if (!g.ok) return { ok: false, reason: "rate_limited", retryAfterSec: g.retryAfterSec };
  }

  bump(ipKey, now);
  if (famKey) bump(famKey, now);
  daily.count += 1;
  prune(now);
  return { ok: true };
}

// ---- storage layer ----

type Slot = { bucket: string; name: string };
type Want = { bucket: string; cap: number; refuse: Gate };

function stored(): boolean {
  return process.env.RATE_LIMIT_STORE !== "off";
}

// What /api/health reports: "stored" when the caps hold across server instances.
export function limiterMode(): "stored" | "memory" {
  return stored() && storageMode() !== "memory" ? "stored" : "memory";
}

function bucketOf(kind: string, key: string, span: "h" | "d", now: number): string {
  const index = Math.floor(now / (span === "h" ? HOUR : DAY));
  const secret = process.env.RATE_LIMIT_SALT || process.env.BLOB_READ_WRITE_TOKEN || "parentdesk";
  return `${span}${index}-${createHmac("sha256", secret).update(`${kind}|${key}`).digest("hex").slice(0, 24)}`;
}

function markName(): string {
  return Date.now().toString(36).padStart(9, "0") + randomBytes(6).toString("hex");
}

// Adds this request's entry and, once it is written, counts the others. null: the bucket
// is full (the entry is taken away again). Throws when storage cannot be reached.
async function take(bucket: string, cap: number): Promise<Slot | null> {
  await retryReleases();
  // Too much still waiting to be taken away: the store is not answering, and adding more
  // would leave entries nobody remembers.
  if (unreleased.length >= UNRELEASED_MAX) throw new Error("clean-up pending");
  const slot: Slot = { bucket, name: markName() };
  let others: number;
  try {
    // a write that fails may still have landed: it is taken away like any other
    await addMark(bucket, slot.name);
    others = (await listMarks(bucket)).filter((n) => n !== slot.name).length;
  } catch (e) {
    await release(slot);
    throw e;
  }
  if (others >= cap) {
    await release(slot);
    return null;
  }
  return slot;
}

// Entries that should be gone and could not be removed (the store did not answer). They
// are tried again before this instance counts anything else; one that is never removed
// only makes its bucket a little stricter until the hour or day is over.
const unreleased: Slot[] = [];
const UNRELEASED_MAX = 500;

async function release(slot: Slot | null): Promise<void> {
  if (!slot) return;
  try {
    await removeMark(slot.bucket, slot.name);
  } catch {
    unreleased.push(slot); // never dropped: `take` stops adding while this is long
  }
}

async function retryReleases(): Promise<void> {
  if (unreleased.length === 0) return;
  const again = unreleased.splice(0, unreleased.length);
  await Promise.all(again.map(release));
}

// Every bucket or none: the index of the one that is full, or the slots taken. Throws
// (holding nothing) when storage cannot be reached.
async function takeAll(wants: Want[]): Promise<Slot[] | number> {
  const got = await Promise.allSettled(wants.map((w) => take(w.bucket, w.cap)));
  const slots = got.map((r) => (r.status === "fulfilled" ? r.value : null));
  const failed = got.find((r) => r.status === "rejected");
  const miss = got.findIndex((r) => r.status === "fulfilled" && r.value === null);
  if (!failed && miss < 0) return slots as Slot[];
  await Promise.all(slots.map(release));
  if (failed && failed.status === "rejected") throw failed.reason;
  return miss;
}

const UNREACHABLE: Gate = { ok: false, reason: "rate_limited", retryAfterSec: 60 };

function unreachable(what: string, e: unknown): Gate {
  console.error("[ratelimit] storage", what, e instanceof Error ? e.message : e);
  return UNREACHABLE;
}

// One key, one hourly cap.
async function storedOne(kind: string, key: string, cap: number, now: number): Promise<{ gate: Gate; slot: Slot | null }> {
  const bucket = bucketOf(kind, key, "h", now);
  const refused: Gate = { ok: false, reason: "rate_limited", retryAfterSec: secondsToNextHour(now) };
  if (isFull(bucket, now)) return { gate: refused, slot: null };
  try {
    const slot = await take(bucket, cap);
    if (slot) {
      tidy(now);
      return { gate: { ok: true }, slot };
    }
    full.set(bucket, now + FULL_FOR);
    return { gate: refused, slot: null };
  } catch (e) {
    return { gate: unreachable(kind, e), slot: null };
  }
}

export async function allowRequest(keys: { ip: string; family: string | null }): Promise<Gate> {
  const now = Date.now();
  const local = localRequest(keys, now);
  if (!local.ok || !stored()) return local;

  const hourly: Want[] = [{ bucket: bucketOf("ip", keys.ip, "h", now), cap: HOURLY_CAP_PER_IP, refuse: { ok: false, reason: "rate_limited", retryAfterSec: secondsToNextHour(now) } }];
  if (keys.family) hourly.push({ bucket: bucketOf("f", keys.family, "h", now), cap: HOURLY_CAP_PER_FAMILY, refuse: { ok: false, reason: "rate_limited", retryAfterSec: secondsToNextHour(now) } });
  const day: Want = { bucket: bucketOf("day", "all", "d", now), cap: DAILY_CAP, refuse: { ok: false, reason: "daily_cap", retryAfterSec: secondsToUtcMidnight() } };

  const refuse = (g: Gate): Gate => {
    forgetRequest(keys);
    return g;
  };
  const known = [day, ...hourly].find((w) => isFull(w.bucket, now));
  if (known) return refuse(known.refuse);

  try {
    // The address and the family first: a request refused there never touches the
    // count everyone shares.
    const mine = await takeAll(hourly);
    if (typeof mine === "number") {
      full.set(hourly[mine].bucket, now + FULL_FOR);
      return refuse(hourly[mine].refuse);
    }
    let slot: Slot | null;
    try {
      slot = await take(day.bucket, day.cap);
    } catch (e) {
      await Promise.all(mine.map(release));
      throw e;
    }
    if (!slot) {
      await Promise.all(mine.map(release));
      full.set(day.bucket, now + FULL_FOR);
      return refuse(day.refuse);
    }
  } catch (e) {
    return refuse(unreachable("request", e));
  }
  tidy(now);
  return { ok: true };
}

// Cheap public reads (the class directory): a per-IP hourly cap of their own, outside the
// daily cap, so searching can never use up the model budget of the families on the instance.
export function allowLookup(ip: string): Gate {
  return localOne(`lookup:${ip}`, HOURLY_LOOKUPS_PER_IP, Date.now());
}

async function allowOne(kind: string, key: string, cap: number): Promise<Gate> {
  const now = Date.now();
  const local = localOne(`${kind}:${key}`, cap, now);
  if (!local.ok || !stored()) return local;
  const { gate } = await storedOne(kind, key, cap, now);
  if (!gate.ok) unbump(`${kind}:${key}`);
  return gate;
}

// Sign-in attempts: a small hourly budget of their own per address.
const HOURLY_SIGNINS_PER_IP = 10;
export function allowSignIn(ip: string): Promise<Gate> {
  return allowOne("signin", ip, HOURLY_SIGNINS_PER_IP);
}

// New families from one address: creating one costs nothing but storage, so it has a cap
// of its own and never touches the model budget.
const HOURLY_SIGNUPS_PER_IP = Number(process.env.HOURLY_SIGNUPS_PER_IP ?? 40);
export function allowSignup(ip: string): Promise<Gate> {
  return allowOne("signup", ip, HOURLY_SIGNUPS_PER_IP);
}

// Wrong class codes for one room, whoever sends them: after twenty in an hour the room
// takes no more guesses for the rest of that hour (the link and QR keep working).
const HOURLY_BAD_CODES_PER_ROOM = 20;
export type CodeGuess = { roomId: string; slot: Slot | null };
// Taken before the code is looked at (so guesses sent side by side cannot all slip through)
// and handed back when the code turns out right. null: no guesses left.
export async function takeCodeGuess(roomId: string): Promise<CodeGuess | null> {
  const now = Date.now();
  if (!localOne(`code:${roomId}`, HOURLY_BAD_CODES_PER_ROOM, now).ok) return null;
  if (!stored()) return { roomId, slot: null };
  const { gate, slot } = await storedOne("code", roomId, HOURLY_BAD_CODES_PER_ROOM, now);
  if (gate.ok) return { roomId, slot };
  unbump(`code:${roomId}`);
  return null;
}
export async function returnCodeGuess(guess: CodeGuess): Promise<void> {
  unbump(`code:${guess.roomId}`);
  if (guess.slot) full.delete(guess.slot.bucket);
  await release(guess.slot);
}

// ---- clearing up ----

// Buckets of hours and days that are over are removed. The one before the current one is
// kept too, so a server whose clock runs a little ahead never takes a bucket another is
// still counting in.
export async function sweepLimiter(now: number = Date.now()): Promise<number> {
  const at: Record<string, number> = { h: Math.floor(now / HOUR) - 1, d: Math.floor(now / DAY) - 1, s: Math.floor(now / SWEEP_EVERY) };
  return sweepMarks((bucket) => {
    const m = /^([hds])(\d+)-/.exec(bucket);
    return Boolean(m) && Number(m![2]) >= at[m![1]];
  });
}

// Does not wait for the daily job: the first counted request of every six hours (one
// entry in the store says a period is taken) clears up after the response has gone out.
function tidy(now: number) {
  const period = Math.floor(now / SWEEP_EVERY);
  if (sweepChecked === period) return;
  sweepChecked = period;
  const run = async () => {
    try {
      const bucket = `s${period}-${"0".repeat(24)}`;
      if ((await listMarks(bucket)).length > 0) return;
      await addMark(bucket, markName());
      await sweepLimiter(now);
    } catch (e) {
      console.error("[ratelimit] sweep", e instanceof Error ? e.message : e);
    }
  };
  try {
    after(run);
  } catch {
    void run(); // outside a request (tests, scripts)
  }
}

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}

// Test hook. `memoryOnly` stands for a new server instance: the counters in memory are
// gone, the stored ones are not.
export function resetRateLimiter(opts: { memoryOnly?: boolean } = {}) {
  buckets.clear();
  full.clear();
  daily = { day: "", count: 0 };
  sweepChecked = -1;
  if (!opts.memoryOnly) unreleased.length = 0;
  if (!opts.memoryOnly) wipeMarks();
}

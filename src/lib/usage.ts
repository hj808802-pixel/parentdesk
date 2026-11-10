import { listDocIds, newId, readDoc, removeDoc, writeDoc } from "./store";

// What the models actually used: every call writes one small document (usage/<id>) with
// the token counts the API reported.
//
// Nothing here is ever read, changed and written back. Tidying up ("folding") copies the
// per-call documents of finished days into one new batch document (usagebatch/<id>) and
// then removes them; a batch is written once and never touched again. Reading adds
// everything up by call id, so a call that is in two batches, or in a batch and still
// lying around on its own, counts once. Two folds running at the same time, or one that
// stops half way, can therefore neither lose a call nor count it twice.

export type Tokens = { calls: number; input: number; output: number; cacheRead: number; cacheWrite: number };
export type UsageByModel = Record<string, Tokens>;
type Call = { at: string; model: string; input: number; output: number; cacheRead: number; cacheWrite: number };
type Batch = { calls: Record<string, Call> };

const RAW = "usage/";
const BATCH = "usagebatch/";
const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x > 0 ? Math.round(x) : 0);
const isCall = (c: unknown): c is Call => Boolean(c) && typeof (c as Call).at === "string" && typeof (c as Call).model === "string";

type ApiResponse = { model?: string; usage?: { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null } | null };

// Called right after a model call returns, before its output is looked at, so refusals
// and unusable answers are counted too. Never throws: a failed write only means one call
// is missing from the count. A call the SDK itself rejects while parsing (it throws without
// handing back the response) cannot be seen here and is not counted.
export async function noteUsage(response: ApiResponse, now: Date = new Date()): Promise<void> {
  try {
    const u = response.usage;
    if (!u || !response.model) return;
    const call: Call = { at: now.toISOString(), model: response.model, input: n(u.input_tokens), output: n(u.output_tokens), cacheRead: n(u.cache_read_input_tokens), cacheWrite: n(u.cache_creation_input_tokens) };
    await writeDoc(`${RAW}${newId(6)}`, JSON.stringify(call));
  } catch (e) {
    console.warn("[usage] not recorded", e instanceof Error ? e.message : e);
  }
}

async function readRaw(): Promise<Map<string, Call>> {
  const out = new Map<string, Call>();
  await Promise.all(
    (await listDocIds(RAW)).map(async (id) => {
      try {
        const raw = await readDoc(`${RAW}${id}`);
        const c = raw ? (JSON.parse(raw) as unknown) : null;
        if (isCall(c)) out.set(id, c);
      } catch {
        /* unreadable: left where it is, tried again next time */
      }
    }),
  );
  return out;
}

// Every call any batch holds. A batch that cannot be read is skipped (and never rewritten).
async function readBatches(): Promise<Map<string, Call>> {
  const out = new Map<string, Call>();
  await Promise.all(
    (await listDocIds(BATCH)).map(async (id) => {
      try {
        const raw = await readDoc(`${BATCH}${id}`);
        const b = raw ? (JSON.parse(raw) as Batch | null) : null;
        if (!b || typeof b.calls !== "object" || b.calls === null) return;
        for (const [callId, c] of Object.entries(b.calls)) if (isCall(c)) out.set(callId, c);
      } catch (e) {
        console.error("[usage] batch unreadable, skipped", id, e instanceof Error ? e.message : e);
      }
    }),
  );
  return out;
}

// One month ("2026-11"): totals per model and calls per day, each call counted once.
export async function readUsage(month: string): Promise<{ month: string; models: UsageByModel; byDay: { day: string; calls: number }[] }> {
  // Per-call documents first, batches second: a fold only ever moves a call from the first
  // place to the second (batch written before the document is removed), so reading in that
  // order sees every call in at least one of them, whenever a fold runs in between.
  const all = await readRaw();
  for (const [id, c] of await readBatches()) all.set(id, c);
  const models: UsageByModel = {};
  const days: Record<string, number> = {};
  for (const c of all.values()) {
    if (!c.at.startsWith(month)) continue;
    const t = (models[c.model] ??= { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    t.calls += 1;
    t.input += n(c.input);
    t.output += n(c.output);
    t.cacheRead += n(c.cacheRead);
    t.cacheWrite += n(c.cacheWrite);
    const day = c.at.slice(0, 10);
    days[day] = (days[day] ?? 0) + 1;
  }
  return { month, models, byDay: Object.entries(days).sort(([a], [b]) => (a < b ? -1 : 1)).map(([day, calls]) => ({ day, calls })) };
}

// Copies the per-call documents of finished days into one new batch, then removes them.
// The batch is complete and written before anything is removed; a per-call document that
// outlives its removal is simply counted once by id.
export async function compactUsage(now: Date = new Date()): Promise<{ days: number; calls: number }> {
  const today = now.toISOString().slice(0, 10);
  const calls: Record<string, Call> = {};
  const days = new Set<string>();
  for (const [id, c] of await readRaw()) {
    const day = c.at.slice(0, 10);
    if (day >= today) continue;
    calls[id] = c;
    days.add(day);
  }
  const ids = Object.keys(calls);
  if (ids.length === 0) return { days: 0, calls: 0 };
  await writeDoc(`${BATCH}${newId(6)}`, JSON.stringify({ calls } satisfies Batch));
  for (const id of ids) await removeDoc(`${RAW}${id}`).catch((e) => console.warn("[usage] per-call document not removed", id, e instanceof Error ? e.message : e));
  return { days: days.size, calls: ids.length };
}

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
export type AdminAction = { at: string; action: string; target: string; note: string };

// One small document per action (adminlog/<id>), so two actions at once never lose one.
const ADMIN_LOG = "adminlog/";
const KEEP_ACTIONS = 200;

export async function recordAdminAction(action: string, target: string, note = ""): Promise<void> {
  const entry: AdminAction = { at: new Date().toISOString(), action, target, note };
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

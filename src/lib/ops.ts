import { readOps, writeOps } from "./store";

// Last runs of the scheduled jobs, kept next to the families for the admin page.

export type Run = { at: string; ms: number; summary: Record<string, unknown> };
export type Runs = Record<string, Run[]>;

const KEEP = 20;

export async function recordRun(name: string, ms: number, summary: Record<string, unknown>): Promise<void> {
  const runs = (await readOps<Runs>("runs")) ?? {};
  runs[name] = [{ at: new Date().toISOString(), ms, summary }, ...(runs[name] ?? [])].slice(0, KEEP);
  await writeOps("runs", runs);
}

import { timingSafeEqual } from "node:crypto";
import { compactUsage } from "@/lib/usage";
import { sweepLimiter } from "@/lib/ratelimit";
import { isPaused } from "@/lib/ops";
import { gmailEnabled, scanFamily } from "@/lib/gmail";
import { recordRun } from "@/lib/ops";
import { canUse } from "@/lib/plan";
import { listFamilyIds, loadFamily, saveFamily } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 300;

// The daily inbox check (vercel.json crons). Vercel calls it with
// "Authorization: Bearer <CRON_SECRET>". Families whose token stopped working are
// skipped until the parent reconnects.

const TOTAL_BUDGET_MS = 240_000;
const PER_FAMILY_MS = 45_000;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET ?? "";
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET) return Response.json({ ok: false, error: "cron_off" }, { status: 404 });
  if (!authorized(req)) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const started = Date.now();
  const ids = await listFamilyIds();
  const summary = { families: ids.length, connected: 0, scanned: 0, added: 0, skipped: 0, errors: 0, stopped_early: false };
  if (gmailEnabled()) {
    for (const id of ids) {
      if (Date.now() - started > TOTAL_BUDGET_MS) {
        summary.stopped_early = true;
        break;
      }
      const rec = await loadFamily(id);
      if (!rec?.gmail || rec.gmail.paused || !canUse(rec, "gmail")) continue;
      if (await isPaused(rec.id)) continue; // paused by the operator: no classification, no extraction
      summary.connected++;
      const r = await scanFamily(rec, { budgetMs: PER_FAMILY_MS });
      await saveFamily(rec);
      summary.scanned += r.scanned;
      summary.added += r.added;
      summary.skipped += r.skipped;
      if (r.error) summary.errors++;
    }
  }
  const ms = Date.now() - started;
  console.log(JSON.stringify({ event: "cron_scan", ms, ...summary }));
  // Fold yesterday's per-call usage documents into one per day.
  await compactUsage().catch((e) => console.error("[cron scan] usage", e));
  // The rate limiter's counters of hours and days that are over.
  await sweepLimiter().catch((e) => console.error("[cron scan] limiter", e));
  await recordRun("scan", ms, summary).catch((e) => console.error("[cron scan] record", e));
  return Response.json({ ok: true, ...summary, ms });
}

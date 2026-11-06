import { timingSafeEqual } from "node:crypto";
import { todayIn } from "@/lib/dates";
import { buildDigest, MailError, sendEmail, unsubscribeToken } from "@/lib/digest";
import { recordRun } from "@/lib/ops";
import { canUse } from "@/lib/plan";
import { bumpCounter, digestEnabled, listFamilyIds, loadFamily, saveFamily } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 300;

// The weekly summary run (vercel.json crons, Sunday evening UTC). One e-mail per family
// that switched it on, has an address and is on the Family plan. A family that already
// got its weekly mail in the last three days is skipped, so a re-run is harmless.

const TOTAL_BUDGET_MS = 240_000;
const RECENT_MS = 3 * 86400000;

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
  const origin = (process.env.NEXT_PUBLIC_SITE_URL ?? "").trim().replace(/\/$/, "") || new URL(req.url).origin;
  const summary = { families: 0, eligible: 0, sent: 0, skipped_recent: 0, errors: 0, off: !digestEnabled(), stopped_early: false };
  if (digestEnabled()) {
    const ids = await listFamilyIds();
    summary.families = ids.length;
    for (const id of ids) {
      if (Date.now() - started > TOTAL_BUDGET_MS) {
        summary.stopped_early = true;
        break;
      }
      const rec = await loadFamily(id);
      if (!rec?.settings.digest || !rec.settings.digestEmail || !canUse(rec, "digest")) continue;
      summary.eligible++;
      const last = rec.digest?.lastWeeklyAt ? Date.parse(rec.digest.lastWeeklyAt) : 0;
      if (Date.now() - last < RECENT_MS) {
        summary.skipped_recent++;
        continue;
      }
      const unsub = unsubscribeToken(rec.id);
      const unsubscribeUrl = unsub ? `${origin}/api/digest/unsubscribe?u=${unsub}` : null;
      const d = buildDigest(rec, todayIn(rec.settings.timezone), { origin, unsubscribeUrl });
      rec.digest ??= { lastSentAt: null, lastWeeklyAt: null, lastError: null };
      try {
        await sendEmail({ to: rec.settings.digestEmail, subject: d.subject, text: d.text, html: d.html, unsubscribeUrl });
        const now = new Date().toISOString();
        rec.digest.lastSentAt = now;
        rec.digest.lastWeeklyAt = now;
        rec.digest.lastError = null;
        bumpCounter(rec, "digest");
        summary.sent++;
      } catch (e) {
        rec.digest.lastError = e instanceof MailError ? e.code : "api";
        summary.errors++;
        console.error("[cron digest]", id, e);
      }
      await saveFamily(rec);
    }
  }
  const ms = Date.now() - started;
  console.log(JSON.stringify({ event: "cron_digest", ms, ...summary }));
  await recordRun("digest", ms, summary).catch((e) => console.error("[cron digest] record", e));
  return Response.json({ ok: true, ...summary, ms });
}

import { backupFits, importBackup } from "@/lib/backup";
import { maxChildrenFor } from "@/lib/plan";
import { allowRequest, clientIp } from "@/lib/ratelimit";
import { MAX_CHILDREN, MAX_ITEMS, MAX_SOURCES, familyFromRequest, saveFamily, toView } from "@/lib/store";

export const runtime = "nodejs";

const MAX_BYTES = 3 * 1024 * 1024;

// Restores a backup file into the family in this browser: adds what is missing, changes
// nothing that is already there. The browser sends a large backup in pieces and first asks
// { check: { itemIds, sourceIds } } whether the whole of it fits, so nothing is written when
// it does not.
export async function POST(req: Request) {
  const rec = await familyFromRequest(req);
  if (!rec) return Response.json({ ok: false, error: "no_family" }, { status: 404 });
  const gate = allowRequest({ ip: clientIp(req), family: rec.id });
  if (!gate.ok) return Response.json({ ok: false, error: gate.reason, retry_after: gate.retryAfterSec }, { status: 429 });
  const text = await req.text().catch(() => "");
  if (!text || text.length > MAX_BYTES) return Response.json({ ok: false, error: text ? "too_large" : "bad_request" }, { status: text ? 413 : 400 });
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return Response.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  const check = (data as { check?: { itemIds?: unknown; sourceIds?: unknown } } | null)?.check;
  if (check) return backupFits(rec, check.itemIds, check.sourceIds) ? Response.json({ ok: true, fits: true }) : Response.json({ ok: false, error: "too_many_items" }, { status: 409 });
  const res = importBackup(rec, data, { children: maxChildrenFor(rec, MAX_CHILDREN), items: MAX_ITEMS, sources: MAX_SOURCES });
  if (!res.ok) return res.reason === "too_many" ? Response.json({ ok: false, error: "too_many_items" }, { status: 409 }) : Response.json({ ok: false, error: "bad_request" }, { status: 400 });
  await saveFamily(rec);
  return Response.json({ ok: true, restored: { children: res.children, sources: res.sources, items: res.items }, family: toView(rec) });
}

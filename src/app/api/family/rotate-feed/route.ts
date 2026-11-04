import { familyFromRequest, rotateFeed, saveFamily, toView } from "@/lib/store";

export const runtime = "nodejs";

// Issues a new read-only calendar address; the old one stops working.
export async function POST(req: Request) {
  const rec = await familyFromRequest(req);
  if (!rec) return Response.json({ ok: false, error: "no_family" }, { status: 404 });
  rotateFeed(rec);
  await saveFamily(rec);
  return Response.json({ ok: true, family: toView(rec) });
}

import { familyFromRequest, rotateHook, saveFamily, toView } from "@/lib/store";

export const runtime = "nodejs";

// Issues a new device-automation address; the old one stops working.
export async function POST(req: Request) {
  const rec = await familyFromRequest(req);
  if (!rec) return Response.json({ ok: false, error: "no_family" }, { status: 404 });
  rotateHook(rec);
  await saveFamily(rec);
  return Response.json({ ok: true, family: toView(rec) });
}

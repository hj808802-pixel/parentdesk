import { familyFromRequest, saveFamily, toView } from "@/lib/store";

export const runtime = "nodejs";

// Removes a notice and every item that came from it.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const rec = await familyFromRequest(req);
  if (!rec) return Response.json({ ok: false, error: "no_family" }, { status: 404 });
  const { id } = await params;
  if (!rec.sources.some((s) => s.id === id)) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  rec.sources = rec.sources.filter((s) => s.id !== id);
  rec.items = rec.items.filter((it) => it.sourceId !== id);
  await saveFamily(rec);
  return Response.json({ ok: true, family: toView(rec) });
}

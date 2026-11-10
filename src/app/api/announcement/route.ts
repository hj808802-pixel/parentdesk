import { activeAnnouncement } from "@/lib/ops";

export const runtime = "nodejs";

// The operator's current announcement for teachers or families, if any (set in the admin
// console). GET ?for=teachers|families → { announcement: { id, text } | null }.
export async function GET(req: Request) {
  const who = new URL(req.url).searchParams.get("for") === "teachers" ? "teachers" : "families";
  const a = await activeAnnouncement(who);
  return Response.json({ ok: true, announcement: a ? { id: a.id, text: a.text } : null }, { headers: { "cache-control": "public, max-age=60" } });
}

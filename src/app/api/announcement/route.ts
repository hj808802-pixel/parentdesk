import { activeAnnouncement, announcementText } from "@/lib/ops";

export const runtime = "nodejs";

// The operator's current announcement for teachers or families, if any (set in the admin
// console). GET ?for=teachers|families&locale=ko → { announcement: { id, text } | null },
// in that language when the announcement was translated.
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const who = params.get("for") === "teachers" ? "teachers" : "families";
  const a = await activeAnnouncement(who);
  return Response.json({ ok: true, announcement: a ? { id: a.id, text: announcementText(a, params.get("locale")) } : null }, { headers: { "cache-control": "public, max-age=60" } });
}

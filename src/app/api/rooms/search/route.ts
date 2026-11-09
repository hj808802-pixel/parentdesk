import { allowLookup, clientIp } from "@/lib/ratelimit";
import { loadDirectory, searchDirectory } from "@/lib/rooms";
import { isCountry } from "@/lib/countries";

export const runtime = "nodejs";

// "Find your class": GET ?q=<school or class words>&country=KR. Lists rooms teachers chose
// to list (school, grade, class, room name, teacher, how many families follow). Finding is
// not joining: the class code from the teacher is still needed (rooms/join).
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const q = (params.get("q") ?? "").trim().slice(0, 80);
  if (q.length < 2) return Response.json({ ok: false, error: "bad_request" }, { status: 400 });
  const gate = allowLookup(clientIp(req));
  if (!gate.ok) return Response.json({ ok: false, error: gate.reason, retry_after: gate.retryAfterSec }, { status: 429, headers: { "Retry-After": String(gate.retryAfterSec) } });
  const country = params.get("country");
  const entries = await loadDirectory();
  const rooms = searchDirectory(entries, q, isCountry(country) ? country : null);
  return Response.json({ ok: true, rooms }, { headers: { "cache-control": "no-store" } });
}

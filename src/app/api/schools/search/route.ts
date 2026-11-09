import { allowLookup, clientIp } from "@/lib/ratelimit";
import { loadDirectory, loadSchools, searchSchools } from "@/lib/rooms";
import { isCountry } from "@/lib/countries";

export const runtime = "nodejs";

// The schools teachers pick from: GET ?q=<name or place words>&country=KR. Each hit says
// how many rooms are listed there, so a teacher recognises their own school and a second
// teacher at the same school lands on the same entry.
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const q = (params.get("q") ?? "").trim().slice(0, 80);
  if (q.length < 2) return Response.json({ ok: false, error: "bad_request" }, { status: 400 });
  const gate = allowLookup(clientIp(req));
  if (!gate.ok) return Response.json({ ok: false, error: gate.reason, retry_after: gate.retryAfterSec }, { status: 429, headers: { "Retry-After": String(gate.retryAfterSec) } });
  const country = params.get("country");
  const [schools, directory] = await Promise.all([loadSchools(), loadDirectory()]);
  return Response.json({ ok: true, schools: searchSchools(schools, directory, q, isCountry(country) ? country : null) }, { headers: { "cache-control": "no-store" } });
}

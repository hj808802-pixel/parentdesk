import { clearFamilyCookie, isHttps } from "@/lib/store";

export const runtime = "nodejs";

// Forgets the family on this device only; the data stays on the server.
export async function POST(req: Request) {
  return Response.json({ ok: true }, { headers: { "set-cookie": clearFamilyCookie(isHttps(req)) } });
}

import { clearTeacherCookie } from "@/lib/rooms";
import { isHttps } from "@/lib/store";

export const runtime = "nodejs";

// Forgets the teacher on this device only; the rooms stay on the server.
export async function POST(req: Request) {
  return Response.json({ ok: true }, { headers: { "set-cookie": clearTeacherCookie(isHttps(req)) } });
}

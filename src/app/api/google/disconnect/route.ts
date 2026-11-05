import { decrypt } from "@/lib/crypto";
import { revokeToken } from "@/lib/gmail";
import { familyFromRequest, saveFamily, toView } from "@/lib/store";

export const runtime = "nodejs";

// Revokes the Gmail token at Google and forgets it. Items already added stay.

export async function POST(req: Request) {
  const rec = await familyFromRequest(req);
  if (!rec) return Response.json({ ok: false, error: "no_family" }, { status: 404 });
  if (rec.gmail) {
    try {
      await revokeToken(decrypt(rec.gmail.refreshToken));
    } catch (e) {
      console.warn("[google/disconnect] revoke skipped", e instanceof Error ? e.message : e);
    }
    rec.gmail = null;
    await saveFamily(rec);
  }
  return Response.json({ ok: true, family: toView(rec) });
}

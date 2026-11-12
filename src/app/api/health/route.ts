import fs from "node:fs";
import path from "node:path";
import { adminEnabled } from "@/lib/admin";
import { planLimits } from "@/lib/plan";
import { limiterMode } from "@/lib/ratelimit";
import { features, storageMode } from "@/lib/store";

export const runtime = "nodejs";

export async function GET() {
  const packsDir = path.join(process.cwd(), "knowledge", "countries");
  const packs = fs.existsSync(packsDir) ? fs.readdirSync(packsDir).filter((f) => f.endsWith(".md")).length : 0;
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  return Response.json(
    {
      ok: true,
      model: process.env.EXTRACT_MODEL || "claude-opus-5-5",
      hasKey,
      mock: process.env.MOCK_EXTRACT === "1" || !hasKey,
      storage: storageMode(),
      rateLimit: limiterMode(),
      inbound: Boolean(process.env.INBOUND_SECRET && process.env.INBOUND_DOMAIN),
      gmail: features().gmail,
      cron: Boolean(process.env.CRON_SECRET),
      billing: features().billing,
      digest: features().digest,
      push: features().push,
      admin: adminEnabled(),
      limits: planLimits(),
      assistModel: process.env.ASSIST_MODEL || "claude-sonnet-5-5",
      packs,
    },
    { headers: { "cache-control": "no-store" } },
  );
}

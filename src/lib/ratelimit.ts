// In-memory limiter for a beta on a single serverless region. It protects the API bill
// from a runaway client, not from a determined attacker. Counters reset on cold start.
//
// Keys: the family id (primary, so one busy family cannot block another on the same
// network), the client IP (a backstop, and the only key before a family exists), and a
// global daily cap.

const HOURLY_CAP_PER_FAMILY = Number(process.env.HOURLY_CAP_PER_FAMILY ?? 20);
const HOURLY_CAP_PER_IP = Number(process.env.HOURLY_CAP_PER_IP ?? 60);
const DAILY_CAP = Number(process.env.DAILY_CAP ?? 500);
const HOURLY_LOOKUPS_PER_IP = Number(process.env.HOURLY_LOOKUPS_PER_IP ?? 120);

const HOUR = 60 * 60 * 1000;

type Window = { windowStart: number; count: number };
const buckets = new Map<string, Window>();
let daily = { day: "", count: 0 };

export type Gate = { ok: true } | { ok: false; reason: "rate_limited" | "daily_cap"; retryAfterSec: number };

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function secondsToUtcMidnight(): number {
  const now = Date.now();
  const next = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + 1);
  return Math.max(60, Math.round((next - now) / 1000));
}

function check(key: string, cap: number, now: number): { ok: boolean; retryAfterSec: number } {
  const w = buckets.get(key);
  if (!w || now - w.windowStart > HOUR) return { ok: true, retryAfterSec: 0 };
  if (w.count >= cap) return { ok: false, retryAfterSec: Math.ceil((w.windowStart + HOUR - now) / 1000) };
  return { ok: true, retryAfterSec: 0 };
}

function bump(key: string, now: number) {
  const w = buckets.get(key);
  if (!w || now - w.windowStart > HOUR) buckets.set(key, { windowStart: now, count: 1 });
  else w.count += 1;
}

export function allowRequest(keys: { ip: string; family: string | null }): Gate {
  const now = Date.now();

  const day = todayUtc();
  if (daily.day !== day) daily = { day, count: 0 };
  if (daily.count >= DAILY_CAP) return { ok: false, reason: "daily_cap", retryAfterSec: secondsToUtcMidnight() };

  const ipKey = `ip:${keys.ip}`;
  const ipGate = check(ipKey, HOURLY_CAP_PER_IP, now);
  if (!ipGate.ok) return { ok: false, reason: "rate_limited", retryAfterSec: ipGate.retryAfterSec };

  const famKey = keys.family ? `f:${keys.family}` : null;
  if (famKey) {
    const g = check(famKey, HOURLY_CAP_PER_FAMILY, now);
    if (!g.ok) return { ok: false, reason: "rate_limited", retryAfterSec: g.retryAfterSec };
  }

  bump(ipKey, now);
  if (famKey) bump(famKey, now);
  daily.count += 1;

  if (buckets.size > 10000) {
    for (const [k, v] of buckets) if (now - v.windowStart > HOUR) buckets.delete(k);
  }
  return { ok: true };
}

// Cheap public reads (the class directory): a per-IP hourly cap of their own, outside the
// daily cap, so searching can never use up the model budget of the families on the instance.
export function allowLookup(ip: string): Gate {
  const now = Date.now();
  const key = `lookup:${ip}`;
  const g = check(key, HOURLY_LOOKUPS_PER_IP, now);
  if (!g.ok) return { ok: false, reason: "rate_limited", retryAfterSec: g.retryAfterSec };
  bump(key, now);
  return { ok: true };
}

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}

// Test hook.
export function resetRateLimiter() {
  buckets.clear();
  daily = { day: "", count: 0 };
}

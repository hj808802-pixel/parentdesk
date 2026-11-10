import { sendNotification, setVapidDetails } from "web-push";
import { saveFamily } from "./store";
import type { FamilyRecord, PushSub } from "./types";

// Web push for new class notices. Optional: without the VAPID key pair in the environment
// nothing is offered and nothing is sent. A subscription is the browser's own push address
// for one device; it is kept with the family and dropped when the browser says it is gone.

export const MAX_PUSH_SUBS = 10;
const PUSH_HOSTS = ["fcm.googleapis.com", "push.services.mozilla.com", "notify.windows.com", "push.apple.com"];
const SEND_TIMEOUT_MS = 5000;

export function pushEnabled(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export function pushPublicKey(): string | null {
  return pushEnabled() ? (process.env.VAPID_PUBLIC_KEY as string) : null;
}

// Only https push services, with the two keys the browser hands out.
export function sanitizePushSub(input: unknown, now: string = new Date().toISOString()): PushSub | null {
  const o = input as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
  if (!o || typeof o.endpoint !== "string" || o.endpoint.length > 1000) return null;
  let url: URL;
  try {
    url = new URL(o.endpoint);
  } catch {
    return null;
  }
  // Only the push services browsers actually use, on the default port: the server posts to
  // this address, so nothing else may be reachable through it.
  if (url.protocol !== "https:" || url.port || url.username || url.password || !PUSH_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`))) return null;
  const p256dh = o.keys?.p256dh;
  const auth = o.keys?.auth;
  if (typeof p256dh !== "string" || typeof auth !== "string" || !/^[A-Za-z0-9_-]{20,200}$/.test(p256dh) || !/^[A-Za-z0-9_-]{8,100}$/.test(auth)) return null;
  return { endpoint: o.endpoint, p256dh, auth, createdAt: now };
}

export function addPushSub(rec: FamilyRecord, sub: PushSub) {
  rec.push = [...(rec.push ?? []).filter((s) => s.endpoint !== sub.endpoint), sub].slice(-MAX_PUSH_SUBS);
}

export function removePushSub(rec: FamilyRecord, endpoint: unknown): boolean {
  const before = (rec.push ?? []).length;
  rec.push = (rec.push ?? []).filter((s) => s.endpoint !== endpoint);
  return rec.push.length < before;
}

export type PushMessage = { title: string; body: string; url: string };

// Sends to every device of the family. Devices the push service no longer knows are
// removed (and the family saved). Returns how many were reached. Never throws.
export async function notifyFamily(rec: FamilyRecord, msg: PushMessage): Promise<number> {
  const subs = rec.push ?? [];
  if (!pushEnabled() || subs.length === 0) return 0;
  setVapidDetails(process.env.VAPID_SUBJECT || "https://parentdesk-app.vercel.app", process.env.VAPID_PUBLIC_KEY as string, process.env.VAPID_PRIVATE_KEY as string);
  const payload = JSON.stringify({ title: msg.title.slice(0, 80), body: msg.body.slice(0, 180), url: msg.url });
  const gone: string[] = [];
  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400, timeout: SEND_TIMEOUT_MS });
        sent++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) gone.push(s.endpoint);
        else console.warn("[push] send failed", status ?? (e instanceof Error ? e.message : e));
      }
    }),
  );
  if (gone.length) {
    rec.push = subs.filter((s) => !gone.includes(s.endpoint));
    try {
      await saveFamily(rec);
    } catch (e) {
      console.warn("[push] could not drop dead subscriptions", e);
    }
  }
  return sent;
}

import type { FamilyView, Item } from "./store";

// Thin fetch helpers for the browser. Every call carries the HttpOnly family cookie.

export type ApiError = { ok: false; error: string; retry_after?: number };
export type FamilyResponse = { ok: true; family: FamilyView; key?: string };

export class ApiFailure extends Error {
  constructor(
    public code: string,
    public status: number,
    public retryAfter?: number,
  ) {
    super(code);
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { ...init, headers: { ...(init.body && !(init.body instanceof FormData) ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) } });
  const body = (await res.json().catch(() => null)) as (T & { ok?: boolean }) | ApiError | null;
  if (!res.ok || !body || body.ok === false) {
    const err = body as ApiError | null;
    throw new ApiFailure(err?.error ?? "generic", res.status, err?.retry_after);
  }
  return body as T;
}

export const api = {
  family: () => call<FamilyResponse>("/api/family"),
  createFamily: (init: { locale?: string; timezone?: string }) => call<FamilyResponse>("/api/family", { method: "POST", body: JSON.stringify(init) }),
  updateFamily: (patch: Record<string, unknown>) => call<FamilyResponse>("/api/family", { method: "PATCH", body: JSON.stringify(patch) }),
  deleteFamily: () => call<{ ok: true }>("/api/family", { method: "DELETE" }),
  joinFamily: (key: string) => call<FamilyResponse>("/api/family/join", { method: "POST", body: JSON.stringify({ key }) }),
  leaveFamily: () => call<{ ok: true }>("/api/family/leave", { method: "POST" }),
  rotateFeed: () => call<FamilyResponse>("/api/family/rotate-feed", { method: "POST" }),
  patchItem: (id: string, patch: Partial<Item> & Record<string, unknown>) => call<{ ok: true; item: Item }>(`/api/items/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteItem: (id: string) => call<{ ok: true }>(`/api/items/${id}`, { method: "DELETE" }),
  deleteSource: (id: string) => call<{ ok: true; family: FamilyView }>(`/api/sources/${id}`, { method: "DELETE" }),
};

// The family key is shown in Settings so a partner can join. The server keeps only a hash,
// so the browser that received the key remembers it here.
const KEY_STORAGE = "pd_family_key";

export function rememberKey(key: string | undefined | null) {
  if (!key) return;
  try {
    window.localStorage.setItem(KEY_STORAGE, key);
  } catch {
    /* storage unavailable */
  }
}

export function readKey(): string {
  try {
    return window.localStorage.getItem(KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}

export function forgetKey() {
  try {
    window.localStorage.removeItem(KEY_STORAGE);
  } catch {
    /* ignore */
  }
}

export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function feedUrl(feedToken: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/api/calendar/${feedToken}.ics`;
}

export async function writeClipboard(text: string): Promise<boolean> {
  if (typeof document === "undefined") return false;
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* denied or unsupported: try the selection route */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.setAttribute("aria-hidden", "true");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.width = "1px";
    ta.style.height = "1px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

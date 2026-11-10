import type { DirectoryHit, RoomPost, RoomPublic, SchoolHit, TeacherView } from "./rooms";
import type { SettingsSuggestion } from "./schema";
import type { FamilyView, Item, PlanLimits } from "./types";

// Thin fetch helpers for the browser. Every call carries the HttpOnly family cookie.

export type ApiError = { ok: false; error: string; retry_after?: number };
export type FamilyResponse = { ok: true; family: FamilyView; key?: string };
export type TeacherResponse = { ok: true; teacher: TeacherView; key?: string };
export type RoomInfoResponse = { ok: true; room: RoomPublic; following: boolean; childIds: string[] };
export type RoomJoinResponse = FamilyResponse & { room: RoomPublic; backfilled: { posts: number; items: number } };
export type RoomPostResponse = { ok: true; saved: boolean; school_related: boolean; preview?: boolean; summary?: string; draft?: RoomPost; post?: RoomPost; delivered?: number; members?: number; languages?: string[]; teacher?: TeacherView; mock: boolean };
export type RoomSendResponse = { ok: true; post: RoomPost; delivered: number; members: number; languages: string[]; teacher: TeacherView };

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
  rotateHook: () => call<FamilyResponse>("/api/family/rotate-hook", { method: "POST" }),
  patchItem: (id: string, patch: Partial<Item> & Record<string, unknown>) => call<{ ok: true; item: Item; next?: Item | null }>(`/api/items/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  bulkItems: (ids: string[], status: "open" | "done" | "dismissed") => call<{ ok: true; changed: number; family: FamilyView }>("/api/items/bulk", { method: "POST", body: JSON.stringify({ ids, status }) }),
  deleteItem: (id: string) => call<{ ok: true }>(`/api/items/${id}`, { method: "DELETE" }),
  deleteSource: (id: string) => call<{ ok: true; family: FamilyView }>(`/api/sources/${id}`, { method: "DELETE" }),
  ask: (question: string) => call<{ ok: true; answer: string; items: Item[]; mock: boolean }>("/api/ask", { method: "POST", body: JSON.stringify({ question }) }),
  assistSettings: (text: string, locale: string) => call<SettingsSuggestion & { ok: true; mock: boolean }>("/api/family/assist-settings", { method: "POST", body: JSON.stringify({ text, locale }) }),
  importCheck: (itemIds: unknown[], sourceIds: unknown[]) => call<{ ok: true; fits: boolean }>("/api/family/import", { method: "POST", body: JSON.stringify({ check: { itemIds, sourceIds } }) }),
  importBackup: (text: string) => call<FamilyResponse & { restored: { children: number; sources: number; items: number } }>("/api/family/import", { method: "POST", body: text }),
  pushSubscribe: (subscription: unknown) => call<FamilyResponse>("/api/push", { method: "POST", body: JSON.stringify({ subscription }) }),
  pushUnsubscribe: (endpoint: string) => call<FamilyResponse>("/api/push", { method: "DELETE", body: JSON.stringify({ endpoint }) }),
  pushTest: () => call<{ ok: true; sent: number }>("/api/push", { method: "POST", body: JSON.stringify({ test: true }) }),
  explain: (id: string) => call<{ ok: true; explanation: string; what_to_do: string[]; context: string | null; ask_school: string | null; mock: boolean }>(`/api/items/${id}/explain`, { method: "POST" }),
  reply: (id: string, intent: string, note: string) =>
    call<{ ok: true; reply: string; translation: string | null; subject: string | null; mock: boolean }>(`/api/items/${id}/reply`, { method: "POST", body: JSON.stringify({ intent, note }) }),
  gmailScan: () => call<{ ok: true; family: FamilyView; result: { scanned: number; picked: number; added: number; skipped: number; error?: string } }>("/api/google/scan", { method: "POST" }),
  gmailDisconnect: () => call<{ ok: true; family: FamilyView }>("/api/google/disconnect", { method: "POST" }),
  invite: (locale: string) => call<{ ok: true; url: string; expiresAt: string; maxUses: number; family: FamilyView }>("/api/family/invite", { method: "POST", body: JSON.stringify({ locale }) }),
  joinInvite: (invite: string) => call<FamilyResponse>("/api/family/join", { method: "POST", body: JSON.stringify({ invite }) }),
  checkout: (interval: "month" | "year") => call<{ ok: true; url: string }>("/api/billing/checkout", { method: "POST", body: JSON.stringify({ interval }) }),
  portal: () => call<{ ok: true; url: string }>("/api/billing/portal", { method: "POST" }),
  digestSend: () => call<{ ok: true; family: FamilyView }>("/api/digest/send", { method: "POST" }),
  digestPreview: () => call<{ ok: true; subject: string; text: string; count: number }>("/api/digest/preview"),
  health: () => call<{ ok: true; billing: boolean; digest: boolean; limits: PlanLimits }>("/api/health"),
  // class rooms: the parent side
  roomInfo: (token: string) => call<RoomInfoResponse>(`/api/rooms/join?r=${encodeURIComponent(token)}`),
  roomInfoById: (id: string) => call<RoomInfoResponse>(`/api/rooms/join?id=${encodeURIComponent(id)}`),
  roomJoin: (token: string, childIds: string[], init: { locale?: string; timezone?: string }) => call<RoomJoinResponse>("/api/rooms/join", { method: "POST", body: JSON.stringify({ token, childIds, ...init }) }),
  roomJoinByCode: (roomId: string, code: string, childIds: string[], init: { locale?: string; timezone?: string }) => call<RoomJoinResponse>("/api/rooms/join", { method: "POST", body: JSON.stringify({ roomId, code, childIds, ...init }) }),
  schoolSearch: (q: string, country?: string) => call<{ ok: true; schools: SchoolHit[] }>(`/api/schools/search?q=${encodeURIComponent(q)}${country ? `&country=${encodeURIComponent(country)}` : ""}`),
  roomMatch: (schoolId: string, grade: string, classLabel: string) => call<{ ok: true; rooms: DirectoryHit[] }>(`/api/rooms/search?schoolId=${encodeURIComponent(schoolId)}&grade=${encodeURIComponent(grade)}&classLabel=${encodeURIComponent(classLabel)}`),
  roomSearch: (q: string, country?: string) => call<{ ok: true; rooms: DirectoryHit[] }>(`/api/rooms/search?q=${encodeURIComponent(q)}${country ? `&country=${encodeURIComponent(country)}` : ""}`),
  roomChildren: (roomId: string, childIds: string[]) => call<FamilyResponse>(`/api/rooms/${roomId}`, { method: "PATCH", body: JSON.stringify({ childIds }) }),
  roomLeave: (roomId: string) => call<FamilyResponse>(`/api/rooms/${roomId}`, { method: "DELETE" }),
  // class rooms: the teacher side
  teacher: () => call<TeacherResponse>("/api/teacher"),
  createTeacher: (init: { name: string; locale?: string; timezone?: string; settings?: Record<string, unknown> }) => call<TeacherResponse>("/api/teacher", { method: "POST", body: JSON.stringify(init) }),
  updateTeacher: (patch: Record<string, unknown>) => call<TeacherResponse>("/api/teacher", { method: "PATCH", body: JSON.stringify(patch) }),
  deleteTeacher: () => call<{ ok: true }>("/api/teacher", { method: "DELETE" }),
  joinTeacher: (key: string) => call<TeacherResponse>("/api/teacher/join", { method: "POST", body: JSON.stringify({ key }) }),
  leaveTeacher: () => call<{ ok: true }>("/api/teacher/leave", { method: "POST" }),
  createRoom: (name: string, details: { grade?: string; classLabel?: string; listed?: boolean } = {}) => call<TeacherResponse & { roomId: string }>("/api/teacher/rooms", { method: "POST", body: JSON.stringify({ name, ...details }) }),
  updateRoom: (id: string, patch: { name?: string; rotate?: boolean; description?: string; grade?: string; classLabel?: string; listed?: boolean }) => call<TeacherResponse>(`/api/teacher/rooms/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteRoom: (id: string) => call<TeacherResponse>(`/api/teacher/rooms/${id}`, { method: "DELETE" }),
  roomDraftSend: (roomId: string, draftId: string, body: { drop: number[]; targets: string[] }) => call<RoomSendResponse>(`/api/teacher/rooms/${roomId}/drafts/${draftId}`, { method: "POST", body: JSON.stringify(body) }),
  roomDraftDiscard: (roomId: string, draftId: string) => call<TeacherResponse>(`/api/teacher/rooms/${roomId}/drafts/${draftId}`, { method: "DELETE" }),
  compose: (roomId: string, body: { kind: string; facts: string; tone: string }) => call<{ ok: true; title: string; notice: string; missing: string[]; mock: boolean }>(`/api/teacher/rooms/${roomId}/compose`, { method: "POST", body: JSON.stringify(body) }),
  translateParent: (text: string) => call<{ ok: true; language: string; translation: string; summary: string; reply: string; reply_translated: string; mock: boolean }>("/api/teacher/translate", { method: "POST", body: JSON.stringify({ text }) }),
  roomPostRecall: (roomId: string, postId: string) => call<TeacherResponse & { families: number; items: number }>(`/api/teacher/rooms/${roomId}/posts/${postId}`, { method: "DELETE" }),
};

// The teacher key is shown on the teacher page so the desk can be opened on another
// device; the server keeps only a hash.
const TEACHER_KEY_STORAGE = "pd_teacher_key";

export function rememberTeacherKey(key: string | undefined | null) {
  if (!key) return;
  try {
    window.localStorage.setItem(TEACHER_KEY_STORAGE, key);
  } catch {
    /* storage unavailable */
  }
}

export function readTeacherKey(): string {
  try {
    return window.localStorage.getItem(TEACHER_KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}

export function forgetTeacherKey() {
  try {
    window.localStorage.removeItem(TEACHER_KEY_STORAGE);
  } catch {
    /* ignore */
  }
}

export function roomJoinUrl(token: string, path: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}${path}?r=${token}`;
}

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

export function hookUrl(hookToken: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/api/hook/${hookToken}`;
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

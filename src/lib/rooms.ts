import { createHash, timingSafeEqual } from "node:crypto";
import { todayIn } from "./dates";
import type { ExtractContext } from "./extract";
import type { Extraction } from "./schema";
import { commitItems, defaultSettings, draftItem, listDocIds, newId, readDoc, removeDoc, sanitizeSettings, writeDoc, type ItemDraft } from "./store";
import type { FamilyRecord, Item, RoomSubscription, Settings, Source } from "./types";

// Class rooms: a teacher posts a notice once, every family that follows the room gets the
// dates and to-dos on its own list, in its own language, with its own children attached.
//
// No accounts here either. A teacher has a teacher key (pdt_<id>_<secret>) in an HttpOnly
// cookie, exactly like a family key; the teacher document keeps its hash. A room has a
// long-lived join secret that the invite link carries (the teacher shows the link again and
// again, so it is kept in clear, and can be rotated). Families keep the room's id and name;
// the room keeps the family ids of its members for the fan-out.
//
// Documents: teachers/<id> (name, settings, room ids, monthly usage) and rooms/<id>
// (members, posts). A post stores the extracted items once, plus a translation per result
// language the members use, so a notice costs one extraction however many families follow.

export const TEACHER_COOKIE = "pd_teacher";
const TEACHERS = "teachers/";
const ROOMS = "rooms/";

export const MAX_ROOMS_PER_TEACHER = 10;
export const MAX_MEMBERS_PER_ROOM = 300;
export const MAX_ROOMS_PER_FAMILY = 20;
const MAX_POSTS_KEPT = 60;
const POSTS_IN_VIEW = 30;
export const BACKFILL_DAYS = 30;
export const BACKFILL_POSTS = 10;
export const MAX_LATE_TRANSLATIONS = 5;

export function teacherPostCap(): number {
  const n = Number(process.env.TEACHER_MONTHLY_POSTS);
  return Number.isFinite(n) && n > 0 ? n : 100;
}

// ---- types ----

export type TeacherRecord = {
  id: string;
  keyHash: string;
  createdAt: string;
  updatedAt: string;
  name: string; // how families see the sender: "Ms. Rivera", "3학년 2반 담임"
  school: string; // optional; shown to families in front of the room's name
  settings: Settings; // country, result language, time zone (familyName and digest unused)
  roomIds: string[];
  usage: Record<string, number>; // "2026-11" -> posts that month
};

export type RoomMember = { familyId: string; joinedAt: string };

export type PostTranslation = { title: string; summary: string; items: ItemDraft[] };

export type RoomPost = {
  id: string;
  ts: string;
  title: string;
  sender: string;
  summary: string;
  language: string; // result language the items were written in (the teacher's)
  pages: number;
  items: ItemDraft[];
  translations: Record<string, PostTranslation>; // result language -> the same post
  delivered: number; // families that received it when it was posted
};

export type RoomRecord = {
  id: string;
  teacherId: string;
  name: string;
  joinSecret: string;
  createdAt: string;
  updatedAt: string;
  members: RoomMember[];
  posts: RoomPost[];
};

// What the teacher's browser sees: no member ids, the join token to build the link.
export type RoomView = Omit<RoomRecord, "joinSecret" | "members"> & { memberCount: number; joinToken: string };
export type TeacherView = Omit<TeacherRecord, "keyHash"> & { rooms: RoomView[]; postCap: number };

// What a parent sees before joining.
export type RoomPublic = { id: string; name: string; teacherName: string; school: string; memberCount: number; postCount: number; language: string };

// Who a post comes from, as families see it. A TeacherRecord fits.
export type Sender = { name: string; school: string };

export function senderOf(teacher: Sender | null | undefined): Sender {
  return { name: teacher?.name ?? "", school: teacher?.school ?? "" };
}

// "<school> · <room> · <teacher>", skipping what is empty.
export function senderLine(sender: Sender, roomName: string): string {
  return [sender.school, roomName, sender.name || "Teacher"].filter(Boolean).join(" · ").slice(0, 120);
}

// ---- keys and tokens ----

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function makeTeacherKey(id: string, secret: string): string {
  return `pdt_${id}_${secret}`;
}

export function parseTeacherKey(key: unknown): { id: string; secret: string } | null {
  if (typeof key !== "string") return null;
  const m = /^pdt_([0-9a-f]{12})_([0-9a-f]{24})$/.exec(key.trim());
  return m ? { id: m[1], secret: m[2] } : null;
}

export function verifyTeacherSecret(rec: TeacherRecord, secret: string): boolean {
  return same(rec.keyHash, hashSecret(secret));
}

// "<room id>.<join secret>"
export function joinTokenOf(room: Pick<RoomRecord, "id" | "joinSecret">): string {
  return `${room.id}.${room.joinSecret}`;
}

export function parseJoinToken(token: unknown): { id: string; secret: string } | null {
  if (typeof token !== "string") return null;
  const m = /^([0-9a-f]{12})\.([0-9a-f]{16})$/.exec(token.trim());
  return m ? { id: m[1], secret: m[2] } : null;
}

export function verifyJoinSecret(room: RoomRecord, secret: string): boolean {
  return same(room.joinSecret, secret);
}

export function rotateJoinSecret(room: RoomRecord) {
  room.joinSecret = newId(8);
}

// ---- cookies ----

export function parseTeacherCookie(cookieHeader: string | null): { id: string; secret: string } | null {
  if (!cookieHeader) return null;
  const m = new RegExp(`(?:^|;\\s*)${TEACHER_COOKIE}=([^;]+)`).exec(cookieHeader);
  return m ? parseTeacherKey(decodeURIComponent(m[1])) : null;
}

export function teacherCookie(key: string, secure: boolean): string {
  return `${TEACHER_COOKIE}=${key}; Path=/; Max-Age=63072000; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export function clearTeacherCookie(secure: boolean): string {
  return `${TEACHER_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export async function teacherFromRequest(req: Request): Promise<TeacherRecord | null> {
  const parsed = parseTeacherCookie(req.headers.get("cookie"));
  if (!parsed) return null;
  const rec = await loadTeacher(parsed.id);
  if (!rec || !verifyTeacherSecret(rec, parsed.secret)) return null;
  return rec;
}

// ---- create ----

export function sanitizeName(x: unknown, fallback = ""): string {
  return typeof x === "string" ? x.replace(/\s+/g, " ").trim().slice(0, 60) : fallback;
}

export function sanitizeSchool(x: unknown): string {
  return typeof x === "string" ? x.replace(/\s+/g, " ").trim().slice(0, 80) : "";
}

export function createTeacher(init: { name?: unknown; school?: unknown; locale?: string | null; timezone?: string | null; settings?: Partial<Settings> } = {}): { record: TeacherRecord; key: string } {
  const now = new Date().toISOString();
  const id = newId(6);
  const secret = newId(12);
  const record: TeacherRecord = {
    id,
    keyHash: hashSecret(secret),
    createdAt: now,
    updatedAt: now,
    name: sanitizeName(init.name),
    school: sanitizeSchool(init.school),
    settings: sanitizeSettings(init.settings ?? {}, defaultSettings(init.locale, init.timezone)),
    roomIds: [],
    usage: {},
  };
  return { record, key: makeTeacherKey(id, secret) };
}

export function createRoom(teacher: TeacherRecord, name: unknown): RoomRecord | null {
  if (teacher.roomIds.length >= MAX_ROOMS_PER_TEACHER) return null;
  const clean = sanitizeName(name);
  if (!clean) return null;
  const now = new Date().toISOString();
  const room: RoomRecord = { id: newId(6), teacherId: teacher.id, name: clean, joinSecret: newId(8), createdAt: now, updatedAt: now, members: [], posts: [] };
  teacher.roomIds = [...teacher.roomIds, room.id];
  return room;
}

// May this teacher post one more notice this month?
export function canPost(teacher: TeacherRecord, month: string): { ok: true } | { ok: false; used: number; limit: number } {
  const used = teacher.usage[month] ?? 0;
  const limit = teacherPostCap();
  return used < limit ? { ok: true } : { ok: false, used, limit };
}

export function teacherContext(teacher: TeacherRecord, todayIso?: string): ExtractContext {
  const s = teacher.settings;
  return { language: s.language, country: s.country, timezone: s.timezone, dateOrder: s.dateOrder, currency: s.currency, weekStart: s.weekStart, childNames: [], todayIso: todayIso ?? todayIn(s.timezone) };
}

// ---- posts ----

// Turns one extraction into a post. A notice with no dated items still reaches the
// families as one "info" item (the teacher's note), so nothing a teacher sends is lost.
export function makePost(room: RoomRecord, teacher: TeacherRecord, extraction: Extraction, pages: number, now: string = new Date().toISOString()): RoomPost {
  const items = extraction.items.slice(0, 40).map((it) => draftItem(it, teacher.settings.currency));
  const title = extraction.source.title.slice(0, 160) || room.name;
  const summary = extraction.source.summary.slice(0, 1200);
  if (items.length === 0) {
    items.push({
      type: "info",
      title,
      description: summary.slice(0, 1000),
      date: null,
      end_date: null,
      time: null,
      end_time: null,
      all_day: true,
      location: null,
      amount: null,
      currency: null,
      bring: [],
      requires_action: false,
      action_text: null,
      confidence: "high",
      quote: null,
    });
  }
  return {
    id: newId(5),
    ts: now,
    title,
    sender: senderLine(teacher, room.name),
    summary,
    language: teacher.settings.language,
    pages,
    items,
    translations: {},
    delivered: 0,
  };
}

export function addPost(room: RoomRecord, post: RoomPost) {
  room.posts.push(post);
  if (room.posts.length > MAX_POSTS_KEPT) room.posts = room.posts.slice(-MAX_POSTS_KEPT);
}

// The post in a family's result language: its translation when one was made, else the
// original. A translation that lost items on the way is not trusted.
export function postForLanguage(post: RoomPost, language: string): { title: string; summary: string; items: ItemDraft[] } {
  const tr = post.translations[language];
  if (tr && tr.items.length === post.items.length) return tr;
  return { title: post.title, summary: post.summary, items: post.items };
}

// Writes one post onto one family's list. Returns null when the family does not follow the
// room, and nothing new when it already has this post.
export function deliverPost(rec: FamilyRecord, room: RoomRecord, post: RoomPost, sender: Sender, now: string = new Date().toISOString()): { items: Item[]; skipped: number } | null {
  const sub = (rec.rooms ?? []).find((s) => s.roomId === room.id);
  if (!sub) return null;
  if (rec.sources.some((s) => s.postId === post.id)) return { items: [], skipped: 0 };
  const content = postForLanguage(post, rec.settings.language);
  const childIds = sub.childIds.filter((id) => rec.children.some((c) => c.id === id));
  const source: Source = {
    id: newId(5),
    ts: now,
    kind: "room",
    title: content.title,
    sender: post.sender,
    summary: content.summary,
    language: post.language,
    pages: post.pages,
    questions: [],
    messagesSeen: 1,
    messagesUsed: 1,
    roomId: room.id,
    postId: post.id,
  };
  const res = commitItems(
    rec,
    source,
    content.items.map((draft) => ({ draft, childIds })),
    false,
  );
  sub.lastPostId = post.id;
  sub.name = room.name;
  sub.teacherName = sender.name;
  sub.school = sender.school;
  return res;
}

// ---- following a room ----

export function sanitizeChildIds(input: unknown, rec: FamilyRecord): string[] {
  if (!Array.isArray(input)) return [];
  const ids = new Set(rec.children.map((c) => c.id));
  return [...new Set(input.filter((x): x is string => typeof x === "string" && ids.has(x)))];
}

export type SubscribeResult = { ok: true; subscription: RoomSubscription; isNew: boolean } | { ok: false; reason: "room_full" | "too_many_rooms" };

export function subscribe(rec: FamilyRecord, room: RoomRecord, sender: Sender, childIds: string[], now: string = new Date().toISOString()): SubscribeResult {
  rec.rooms ??= [];
  const existing = rec.rooms.find((s) => s.roomId === room.id);
  if (existing) {
    existing.childIds = childIds;
    existing.name = room.name;
    existing.teacherName = sender.name;
    existing.school = sender.school;
    if (!room.members.some((m) => m.familyId === rec.id)) room.members.push({ familyId: rec.id, joinedAt: now });
    return { ok: true, subscription: existing, isNew: false };
  }
  if (rec.rooms.length >= MAX_ROOMS_PER_FAMILY) return { ok: false, reason: "too_many_rooms" };
  if (room.members.length >= MAX_MEMBERS_PER_ROOM) return { ok: false, reason: "room_full" };
  const subscription: RoomSubscription = { roomId: room.id, name: room.name, teacherName: sender.name, school: sender.school, childIds, joinedAt: now, lastPostId: null };
  rec.rooms.push(subscription);
  room.members.push({ familyId: rec.id, joinedAt: now });
  return { ok: true, subscription, isNew: true };
}

// The posts a family that joins now would get: the last few within a month.
export function recentPosts(room: RoomRecord, now: Date = new Date()): RoomPost[] {
  const since = new Date(now.getTime() - BACKFILL_DAYS * 86400000).toISOString();
  return room.posts.filter((p) => p.ts >= since).slice(-BACKFILL_POSTS);
}

// Among those, the ones not yet written in `language` (newest first, a few at most): the
// join route translates them before the backfill, so a late joiner reads them too, and
// the room keeps the translation for the next family with that language.
export function postsNeedingTranslation(posts: RoomPost[], language: string, max = MAX_LATE_TRANSLATIONS): RoomPost[] {
  return posts
    .filter((p) => p.language !== language && !(p.translations[language] && p.translations[language].items.length === p.items.length))
    .slice(-max);
}

// A family that joins late gets the room's recent posts (the last few within a month).
export function backfill(rec: FamilyRecord, room: RoomRecord, sender: Sender, now: Date = new Date()): { posts: number; items: number } {
  const recent = recentPosts(room, now);
  let posts = 0;
  let items = 0;
  for (const post of recent) {
    const res = deliverPost(rec, room, post, sender, now.toISOString());
    if (res && res.items.length) {
      posts++;
      items += res.items.length;
    }
  }
  return { posts, items };
}

// Items already delivered stay on the family's list; only future posts stop.
export function unsubscribe(rec: FamilyRecord, room: RoomRecord | null, roomId: string): boolean {
  const before = (rec.rooms ?? []).length;
  rec.rooms = (rec.rooms ?? []).filter((s) => s.roomId !== roomId);
  if (room) room.members = room.members.filter((m) => m.familyId !== rec.id);
  return rec.rooms.length < before;
}

// ---- views ----

export function roomView(room: RoomRecord): RoomView {
  const { joinSecret: _s, members, posts, ...rest } = room;
  void _s;
  return { ...rest, posts: posts.slice(-POSTS_IN_VIEW), memberCount: members.length, joinToken: joinTokenOf(room) };
}

export function teacherView(teacher: TeacherRecord, rooms: RoomRecord[]): TeacherView {
  const { keyHash: _k, ...rest } = teacher;
  void _k;
  return { ...rest, rooms: rooms.map(roomView), postCap: teacherPostCap() };
}

export function roomPublic(room: RoomRecord, teacher: TeacherRecord | null): RoomPublic {
  return { id: room.id, name: room.name, teacherName: teacher?.name ?? "", school: teacher?.school ?? "", memberCount: room.members.length, postCount: room.posts.length, language: teacher?.settings.language ?? "en" };
}

// ---- storage ----

export async function loadTeacher(id: string): Promise<TeacherRecord | null> {
  if (!/^[0-9a-f]{12}$/.test(id)) return null;
  const raw = await readDoc(`${TEACHERS}${id}`);
  if (!raw) return null;
  try {
    const rec = JSON.parse(raw) as TeacherRecord;
    if (!rec || rec.id !== id || !rec.keyHash) return null;
    rec.roomIds ??= [];
    rec.usage ??= {};
    rec.name = sanitizeName(rec.name);
    rec.school = sanitizeSchool(rec.school);
    rec.settings = sanitizeSettings(rec.settings, defaultSettings());
    return rec;
  } catch {
    return null;
  }
}

export async function saveTeacher(rec: TeacherRecord): Promise<void> {
  rec.updatedAt = new Date().toISOString();
  await writeDoc(`${TEACHERS}${rec.id}`, JSON.stringify(rec));
}

export async function deleteTeacher(id: string): Promise<void> {
  await removeDoc(`${TEACHERS}${id}`);
}

export async function loadRoom(id: string): Promise<RoomRecord | null> {
  if (!/^[0-9a-f]{12}$/.test(id)) return null;
  const raw = await readDoc(`${ROOMS}${id}`);
  if (!raw) return null;
  try {
    const room = JSON.parse(raw) as RoomRecord;
    if (!room || room.id !== id || !room.teacherId || !room.joinSecret) return null;
    room.members ??= [];
    room.posts ??= [];
    for (const p of room.posts) p.translations ??= {};
    return room;
  } catch {
    return null;
  }
}

export async function saveRoom(room: RoomRecord): Promise<void> {
  room.updatedAt = new Date().toISOString();
  await writeDoc(`${ROOMS}${room.id}`, JSON.stringify(room));
}

export async function deleteRoom(id: string): Promise<void> {
  await removeDoc(`${ROOMS}${id}`);
}

export async function loadRooms(teacher: TeacherRecord): Promise<RoomRecord[]> {
  const rooms = await Promise.all(teacher.roomIds.map((id) => loadRoom(id)));
  return rooms.filter((r): r is RoomRecord => Boolean(r && r.teacherId === teacher.id));
}

export async function listTeacherIds(): Promise<string[]> {
  return listDocIds(TEACHERS);
}

export async function listRoomIds(): Promise<string[]> {
  return listDocIds(ROOMS);
}

// Operator numbers for the admin console: counts only.
export type RoomStats = { teachers: number; rooms: number; members: number; posts: number; posts7d: number; delivered: number; languages: number };

export function roomStats(teacherCount: number, rooms: RoomRecord[], now: Date = new Date()): RoomStats {
  const d7 = new Date(now.getTime() - 7 * 86400000).toISOString();
  const s: RoomStats = { teachers: teacherCount, rooms: rooms.length, members: 0, posts: 0, posts7d: 0, delivered: 0, languages: 0 };
  const langs = new Set<string>();
  for (const r of rooms) {
    s.members += r.members.length;
    for (const p of r.posts) {
      s.posts++;
      if (p.ts >= d7) s.posts7d++;
      s.delivered += p.delivered;
      for (const l of Object.keys(p.translations)) langs.add(l);
    }
  }
  s.languages = langs.size;
  return s;
}

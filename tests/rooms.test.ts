import { beforeEach, describe, expect, it } from "vitest";
import { translatePost } from "@/lib/assist";
import { mockExtraction } from "@/lib/extract";
import {
  addDraft,
  addPost,
  backfill,
  dropItems,
  recallFromFamily,
  recallPost,
  removePost,
  sanitizeDescription,
  sendPost,
  takeDraft,
  postsNeedingTranslation,
  recentPosts,
  canPost,
  createRoom,
  createTeacher,
  deliverPost,
  joinTokenOf,
  loadRoom,
  loadRooms,
  loadTeacher,
  makePost,
  MAX_ROOMS_PER_TEACHER,
  parseJoinToken,
  parseTeacherCookie,
  parseTeacherKey,
  postForLanguage,
  roomPublic,
  roomStats,
  roomView,
  rotateJoinSecret,
  saveRoom,
  saveTeacher,
  subscribe,
  teacherContext,
  teacherView,
  unsubscribe,
  verifyJoinSecret,
  verifyTeacherSecret,
} from "@/lib/rooms";
import { createFamily, loadFamily, resetMemoryStore, sanitizeChildren, saveFamily, toView } from "@/lib/store";

const anyPost = (room: Parameters<typeof makePost>[0], teacher: Parameters<typeof makePost>[1]) => makePost(room, teacher, mockExtraction(ctx), 1);

const ctx = { language: "en", country: "US", timezone: "America/New_York", dateOrder: "MDY" as const, currency: "USD", weekStart: 0 as const, childNames: [], todayIso: "2026-11-05" };

describe("rooms", () => {
  beforeEach(() => {
    delete process.env.LOCAL_DATA_DIR;
    delete process.env.BLOB_READ_WRITE_TOKEN;
    delete process.env.TEACHER_MONTHLY_POSTS;
    process.env.MOCK_EXTRACT = "1";
    resetMemoryStore();
  });

  it("creates a teacher with a verifiable key and a cookie that parses", async () => {
    const { record, key } = createTeacher({ name: "  Ms.   Rivera ", locale: "ko" });
    expect(key).toMatch(/^pdt_[0-9a-f]{12}_[0-9a-f]{24}$/);
    const parsed = parseTeacherKey(key)!;
    expect(parsed.id).toBe(record.id);
    expect(verifyTeacherSecret(record, parsed.secret)).toBe(true);
    expect(verifyTeacherSecret(record, "0".repeat(24))).toBe(false);
    expect(parseTeacherKey("pd_0123456789ab_" + "f".repeat(24))).toBeNull(); // a family key is not a teacher key
    expect(parseTeacherCookie(`pd_family=pd_x; pd_teacher=${key}`)?.id).toBe(record.id);
    expect(record.name).toBe("Ms. Rivera");
    expect(record.school).toBe("");
    expect(createTeacher({ name: "T", school: "  Oak   Street  Elementary " }).record.school).toBe("Oak Street Elementary");
    expect(record.settings.country).toBe("KR");
    expect(record.settings.language).toBe("ko");
    const view = teacherView(record, []) as unknown as Record<string, unknown>;
    expect(view.keyHash).toBeUndefined();
    expect(view.postCap).toBe(100);
    await saveTeacher(record);
    expect((await loadTeacher(record.id))?.name).toBe("Ms. Rivera");
    expect(await loadTeacher("nope")).toBeNull();
  });

  it("opens rooms with join tokens, up to the cap", () => {
    const { record: teacher } = createTeacher({ name: "T" });
    expect(createRoom(teacher, "   ")).toBeNull();
    const room = createRoom(teacher, "Room 12")!;
    expect(teacher.roomIds).toEqual([room.id]);
    const token = joinTokenOf(room);
    expect(token).toMatch(/^[0-9a-f]{12}\.[0-9a-f]{16}$/);
    const parsed = parseJoinToken(token)!;
    expect(parsed.id).toBe(room.id);
    expect(verifyJoinSecret(room, parsed.secret)).toBe(true);
    expect(parseJoinToken(`${room.id}.${"0".repeat(32)}`)).toBeNull(); // an invite token is not a join token
    rotateJoinSecret(room);
    expect(verifyJoinSecret(room, parsed.secret)).toBe(false);
    for (let i = 1; i < MAX_ROOMS_PER_TEACHER; i++) expect(createRoom(teacher, `Room ${i}`)).not.toBeNull();
    expect(createRoom(teacher, "One too many")).toBeNull();
    const view = roomView(room) as unknown as Record<string, unknown>;
    expect(view.joinSecret).toBeUndefined();
    expect(view.members).toBeUndefined();
    expect(view.memberCount).toBe(0);
    expect(view.joinToken).toBe(joinTokenOf(room));
    expect(roomPublic(room, teacher)).toMatchObject({ id: room.id, name: "Room 12", teacherName: "T", school: "", memberCount: 0 });
  });

  it("turns an extraction into a post and keeps a note with no dates as one info item", () => {
    const { record: teacher } = createTeacher({ name: "Ms. Rivera" });
    const room = createRoom(teacher, "Room 12")!;
    const post = makePost(room, teacher, mockExtraction(ctx), 1, "2026-11-05T10:00:00.000Z");
    expect(post.items.length).toBe(9);
    expect(post.sender).toBe("Room 12 · Ms. Rivera");
    teacher.school = "Oak Street Elementary";
    expect(makePost(room, teacher, mockExtraction(ctx), 1).sender).toBe("Oak Street Elementary · Room 12 · Ms. Rivera");
    teacher.school = "";
    expect(post.language).toBe("en");
    expect(post.translations).toEqual({});
    const ex = mockExtraction(ctx);
    ex.items = [];
    ex.source.title = "Thank you for the party";
    const note = makePost(room, teacher, ex, 1);
    expect(note.items.length).toBe(1);
    expect(note.items[0].type).toBe("info");
    expect(note.items[0].title).toBe("Thank you for the party");
    expect(teacherContext(teacher).childNames).toEqual([]);
    expect(canPost(teacher, "2026-11").ok).toBe(true);
    teacher.usage["2026-11"] = 100;
    expect(canPost(teacher, "2026-11")).toEqual({ ok: false, used: 100, limit: 100 });
    process.env.TEACHER_MONTHLY_POSTS = "500";
    expect(canPost(teacher, "2026-11").ok).toBe(true);
  });

  it("delivers a post to a following family with its children, once, without counting usage", () => {
    const { record: teacher } = createTeacher({ name: "Ms. Rivera" });
    const room = createRoom(teacher, "Room 12")!;
    const { record: fam } = createFamily({ locale: "ko" });
    fam.children = sanitizeChildren([{ name: "민준" }, { name: "서연" }], []);
    expect(deliverPost(fam, room, makePost(room, teacher, mockExtraction(ctx), 1), teacher)).toBeNull(); // not following yet
    const sub = subscribe(fam, room, teacher, [fam.children[1].id]);
    expect(sub.ok).toBe(true);
    expect(room.members.map((m) => m.familyId)).toEqual([fam.id]);
    const post = makePost(room, teacher, mockExtraction(ctx), 1);
    post.translations.ko = { title: "12반 소식", summary: "요약", items: post.items.map((it) => ({ ...it, title: `KO ${it.title}` })) };
    const res = deliverPost(fam, room, post, teacher)!;
    expect(res.items.length).toBe(9);
    expect(res.items.every((it) => it.childIds.length === 1 && it.childIds[0] === fam.children[1].id)).toBe(true);
    expect(res.items[0].title.startsWith("KO ")).toBe(true); // the family reads Korean
    expect(fam.sources.length).toBe(1);
    expect(fam.sources[0]).toMatchObject({ kind: "room", roomId: room.id, postId: post.id, title: "12반 소식", sender: "Room 12 · Ms. Rivera" });
    expect(Object.keys(fam.usage)).toEqual([]); // the family did not spend an extraction
    expect(fam.rooms?.[0].lastPostId).toBe(post.id);
    // the same post again: nothing new
    expect(deliverPost(fam, room, post, teacher)).toEqual({ items: [], skipped: 0 });
    // a translation that lost items is not trusted
    post.translations.ko.items = post.translations.ko.items.slice(1);
    expect(postForLanguage(post, "ko").items.length).toBe(9);
    expect(postForLanguage(post, "ja").title).toBe(post.title);
    // joining again only updates the children
    const again = subscribe(fam, room, teacher, []);
    expect(again.ok && !again.isNew).toBe(true);
    expect(fam.rooms?.length).toBe(1);
    expect(room.members.length).toBe(1);
    const view = toView(fam);
    expect(view.rooms?.[0].roomId).toBe(room.id);
  });

  it("backfills recent posts for a late joiner and stops delivering after leaving", () => {
    const { record: teacher } = createTeacher({ name: "T" });
    const room = createRoom(teacher, "Room 12")!;
    const now = new Date("2026-11-05T12:00:00.000Z");
    const old = makePost(room, teacher, mockExtraction(ctx), 1, "2026-09-01T10:00:00.000Z");
    const recent = makePost(room, teacher, mockExtraction({ ...ctx, todayIso: "2026-11-01" }), 1, "2026-11-01T10:00:00.000Z");
    addPost(room, old);
    addPost(room, recent);
    const { record: fam } = createFamily();
    expect(subscribe(fam, room, teacher, []).ok).toBe(true);
    const got = backfill(fam, room, teacher, now);
    expect(got.posts).toBe(1);
    expect(got.items).toBe(9);
    expect(fam.sources.map((s) => s.postId)).toEqual([recent.id]);
    expect(unsubscribe(fam, room, room.id)).toBe(true);
    expect(unsubscribe(fam, room, room.id)).toBe(false);
    expect(room.members.length).toBe(0);
    expect(fam.items.length).toBe(9); // delivered items stay
    expect(deliverPost(fam, room, makePost(room, teacher, mockExtraction(ctx), 1), teacher)).toBeNull();
  });

  it("stores teachers and rooms, and only lists a teacher's own rooms", async () => {
    const { record: teacher } = createTeacher({ name: "A" });
    const { record: other } = createTeacher({ name: "B" });
    const mine = createRoom(teacher, "Mine")!;
    const theirs = createRoom(other, "Theirs")!;
    teacher.roomIds.push(theirs.id); // a stale or forged id
    await saveRoom(mine);
    await saveRoom(theirs);
    await saveTeacher(teacher);
    const rooms = await loadRooms(teacher);
    expect(rooms.map((r) => r.name)).toEqual(["Mine"]);
    expect((await loadRoom(mine.id))?.joinSecret).toBe(mine.joinSecret);
    const { record: fam } = createFamily();
    subscribe(fam, mine, teacher, []);
    await saveFamily(fam);
    expect((await loadFamily(fam.id))?.rooms?.[0].name).toBe("Mine");
    addPost(mine, makePost(mine, teacher, mockExtraction(ctx), 1));
    mine.posts[0].delivered = 3;
    mine.posts[0].translations.ko = { title: "", summary: "", items: [] };
    const s = roomStats(2, [mine, theirs]);
    expect(s).toEqual({ teachers: 2, rooms: 2, members: 1, posts: 1, posts7d: 1, delivered: 3, languages: 1 });
  });

  it("tells which recent posts a late joiner still cannot read", () => {
    const { record: teacher } = createTeacher({ name: "T" }); // language en
    const room = createRoom(teacher, "R")!;
    const now = new Date("2026-11-05T12:00:00.000Z");
    const old = makePost(room, teacher, mockExtraction(ctx), 1, "2026-09-01T10:00:00.000Z");
    const a = makePost(room, teacher, mockExtraction(ctx), 1, "2026-11-01T10:00:00.000Z");
    const b = makePost(room, teacher, mockExtraction(ctx), 1, "2026-11-03T10:00:00.000Z");
    const c = makePost(room, teacher, mockExtraction(ctx), 1, "2026-11-04T10:00:00.000Z");
    [old, a, b, c].forEach((p) => addPost(room, p));
    expect(recentPosts(room, now).map((p) => p.id)).toEqual([a.id, b.id, c.id]);
    b.translations.ko = { title: "b", summary: "b", items: b.items };
    c.translations.ko = { title: "c", summary: "c", items: c.items.slice(1) }; // incomplete: not trusted
    expect(postsNeedingTranslation(recentPosts(room, now), "ko").map((p) => p.id)).toEqual([a.id, c.id]);
    expect(postsNeedingTranslation(recentPosts(room, now), "en")).toEqual([]); // the room's own language
    expect(postsNeedingTranslation(recentPosts(room, now), "ja", 1).map((p) => p.id)).toEqual([c.id]); // newest first when capped
  });

  it("keeps drafts, sends one post to several rooms once per family, and recalls it", async () => {
    const { record: teacher } = createTeacher({ name: "T" }); // writes in English
    const a = createRoom(teacher, "A")!;
    const b = createRoom(teacher, "B")!;
    const { record: famA } = createFamily();
    const { record: famAB } = createFamily({ locale: "ko" });
    subscribe(famA, a, teacher, []);
    subscribe(famAB, a, teacher, []);
    subscribe(famAB, b, teacher, []);
    await saveFamily(famA);
    await saveFamily(famAB);
    await saveTeacher(teacher);
    const post = anyPost(a, teacher);
    addDraft(a, post);
    expect(a.drafts.map((d) => d.id)).toEqual([post.id]);
    const trimmed = dropItems(post, [0, 99, -1, "x"]);
    expect(trimmed.items.length).toBe(post.items.length - 1);
    expect(dropItems(post, []).items.length).toBe(post.items.length);
    expect(takeDraft(a, post.id)?.id).toBe(post.id);
    expect(takeDraft(a, post.id)).toBeNull();
    expect(a.drafts).toEqual([]);
    const sent = await sendPost(teacher, [a, b], trimmed);
    expect(sent).toMatchObject({ members: 2, delivered: 2, languages: ["ko"] });
    expect(a.posts.map((p) => p.id)).toEqual([post.id]);
    expect(b.posts.map((p) => p.id)).toEqual([post.id]); // the same post sits in both rooms
    const ab = (await loadFamily(famAB.id))!;
    expect(ab.sources.filter((s) => s.postId === post.id).length).toBe(1); // in two rooms, delivered once
    expect(ab.items.length).toBe(trimmed.items.length);
    expect(ab.sources[0].title.startsWith("[ko] ")).toBe(true); // translated for the Korean family
    expect((await loadFamily(famA.id))!.sources[0].title.startsWith("[ko] ")).toBe(false);
    expect(recallFromFamily(famA, "nope")).toEqual({ sources: 0, items: 0 });
    const res = await recallPost(teacher, post.id);
    expect(res).toEqual({ rooms: 2, families: 2, items: trimmed.items.length * 2 });
    expect((await loadFamily(famAB.id))!.items.length).toBe(0);
    expect((await loadFamily(famAB.id))!.sources.length).toBe(0);
    expect((await loadRoom(a.id))!.posts.length).toBe(0);
    const bb = (await loadRoom(b.id))!; // the stored copy, not the local object
    expect(bb.posts.length).toBe(0);
    expect(removePost(bb, post.id)).toBe(false); // already gone
    expect(sanitizeDescription("  Office   hours\n Tue ")).toBe("Office hours Tue");
    expect(sanitizeDescription("x".repeat(400)).length).toBe(300);
  });

  it("translates a post in demo mode and keeps the item shape", async () => {
    const { record: teacher } = createTeacher({ name: "T" });
    const room = createRoom(teacher, "R")!;
    const post = makePost(room, teacher, mockExtraction(ctx), 1);
    const { result, mock } = await translatePost(post, "en", "ko");
    expect(mock).toBe(true);
    expect(result.items.length).toBe(post.items.length);
    expect(result.title.startsWith("[ko] ")).toBe(true);
    expect(result.items[0].date).toBe(post.items[0].date);
  });
});

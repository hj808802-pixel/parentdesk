import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { adminByToken, adminCookieFor, adminOf, adminUsers } from "@/lib/admin";
import { announcementText, isTeacherPaused, setAnnouncement, setTeacherPaused } from "@/lib/ops";
import { listDocIds, readDoc, resetMemoryStore, writeDoc } from "@/lib/store";
import { compactUsage, noteUsage, readUsage } from "@/lib/usage";

const OWNER = "0123456789abcdef0123456789abcdef";
const VIEWER = "viewer-token-0123456789";

describe("model usage", () => {
  beforeEach(() => {
    delete process.env.LOCAL_DATA_DIR;
    delete process.env.BLOB_READ_WRITE_TOKEN;
    resetMemoryStore();
  });

  it("adds up what each call reported, per model, and survives the daily fold", async () => {
    const yesterday = new Date(Date.UTC(2026, 10, 9, 12));
    const today = new Date(Date.UTC(2026, 10, 10, 9));
    await Promise.all([
      noteUsage({ model: "claude-opus-5-5", usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 50, cache_creation_input_tokens: null } }, yesterday),
      noteUsage({ model: "claude-opus-5-5", usage: { input_tokens: 500, output_tokens: 100 } }, today),
      noteUsage({ model: "claude-sonnet-5-5", usage: { input_tokens: 30, output_tokens: 10 } }, today),
      noteUsage({ model: "x", usage: null }, today), // nothing reported: nothing counted
      noteUsage({ usage: { input_tokens: 1 } }, today),
    ]);
    const before = await readUsage("2026-11");
    expect(before.models["claude-opus-5-5"]).toEqual({ calls: 2, input: 1500, output: 300, cacheRead: 50, cacheWrite: 0 });
    expect(before.models["claude-sonnet-5-5"].calls).toBe(1);
    expect(before.byDay).toEqual([
      { day: "2026-11-09", calls: 1 },
      { day: "2026-11-10", calls: 2 },
    ]);
    // folding finished days changes nothing in the totals, twice over
    expect(await compactUsage(today)).toEqual({ days: 1, calls: 1 });
    expect(await compactUsage(today)).toEqual({ days: 0, calls: 0 });
    expect(await readUsage("2026-11")).toEqual(before);
    expect((await readUsage("2026-12")).models).toEqual({});
  });

  it("counts a call once however the fold is repeated, interleaved or interrupted", async () => {
    const day = new Date(Date.UTC(2026, 10, 8, 12));
    const later = new Date(Date.UTC(2026, 10, 10, 9));
    await noteUsage({ model: "m", usage: { input_tokens: 10, output_tokens: 5 } }, day);
    await noteUsage({ model: "m", usage: { input_tokens: 20, output_tokens: 1 } }, day);
    const ids = await listDocIds("usage/");
    const bodies = await Promise.all(ids.map((id) => readDoc(`usage/${id}`)));
    // two folds over the same documents (as if they ran at once): two batches, each call once
    await compactUsage(later);
    await Promise.all(ids.map((id, i) => writeDoc(`usage/${id}`, bodies[i]!)));
    await compactUsage(later);
    expect(await listDocIds("usagebatch/")).toHaveLength(2);
    expect((await readUsage("2026-11")).models.m).toEqual({ calls: 2, input: 30, output: 6, cacheRead: 0, cacheWrite: 0 });
    // a per-call document that outlived its removal is still one call
    await writeDoc(`usage/${ids[0]}`, bodies[0]!);
    expect((await readUsage("2026-11")).models.m.calls).toBe(2);
    // a damaged batch is skipped, never rewritten, and does not stop the others
    await writeDoc("usagebatch/aaaaaaaaaaaa", "{broken");
    expect((await readUsage("2026-11")).models.m.calls).toBe(2);
    await compactUsage(later);
    expect(await readDoc("usagebatch/aaaaaaaaaaaa")).toBe("{broken");
  });
});

describe("admin accounts and roles", () => {
  beforeEach(() => {
    process.env.ADMIN_TOKEN = OWNER;
    process.env.ADMIN_USERS = `mina:viewer:${VIEWER}, bad:boss:token-token-token-1, short:viewer:abc, mina:owner:another-token-0123456789`;
  });
  afterEach(() => {
    delete process.env.ADMIN_USERS;
    delete process.env.ADMIN_TOKEN;
  });

  it("reads the accounts, ignoring malformed and duplicate entries", () => {
    expect(adminUsers().map((u) => `${u.name}:${u.role}`)).toEqual(["owner:owner", "mina:viewer"]);
    expect(adminByToken(VIEWER)?.role).toBe("viewer");
    expect(adminByToken(OWNER)?.name).toBe("owner");
    expect(adminByToken("another-token-0123456789")).toBeNull();
    expect(adminByToken(null)).toBeNull();
  });

  it("keeps the role inside the session: a viewer cannot become an owner", () => {
    const viewer = adminByToken(VIEWER)!;
    const cookie = adminCookieFor(viewer, true).split(";")[0];
    const req = (c: string) => new Request("https://x/", { headers: { cookie: c } });
    expect(adminOf(req(cookie))).toEqual({ name: "mina", role: "viewer" });
    // renaming the session to the owner breaks the signature
    expect(adminOf(req(cookie.replace(".mina.", ".owner.")))).toBeNull();
    // promoting the account in the environment ends the old session too
    process.env.ADMIN_USERS = `mina:owner:${VIEWER}`;
    expect(adminOf(req(cookie))).toBeNull();
    // and removing the account ends it
    process.env.ADMIN_USERS = "";
    expect(adminOf(req(cookie))).toBeNull();
  });
});

describe("teacher pause and translated announcements", () => {
  beforeEach(() => {
    delete process.env.LOCAL_DATA_DIR;
    delete process.env.BLOB_READ_WRITE_TOKEN;
    resetMemoryStore();
  });

  it("pauses and resumes a teacher desk, and treats a damaged document as an error", async () => {
    const id = "a".repeat(12);
    expect(await isTeacherPaused(id)).toBe(false);
    await setTeacherPaused(id, true);
    expect(await isTeacherPaused(id)).toBe(true);
    await setTeacherPaused(id, false);
    expect(await isTeacherPaused(id)).toBe(false);
    await writeDoc(`teacheradmin/${id}`, "{}");
    await expect(isTeacherPaused(id)).rejects.toThrow();
  });

  it("shows an announcement in the reader's language when it was translated", async () => {
    const doc = (await setAnnouncement("Maintenance on Sunday", "all", 3, { ko: "일요일 점검", ja: " " }))!;
    expect(announcementText(doc, "ko")).toBe("일요일 점검");
    expect(announcementText(doc, "ja")).toBe("Maintenance on Sunday"); // an empty translation falls back
    expect(announcementText(doc, "fr")).toBe("Maintenance on Sunday");
    expect(announcementText(doc, null)).toBe("Maintenance on Sunday");
  });
});

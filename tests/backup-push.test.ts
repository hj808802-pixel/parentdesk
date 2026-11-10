import { beforeEach, describe, expect, it } from "vitest";
import { BACKUP_FORMAT, backupFits, exportBackup, importBackup } from "@/lib/backup";
import { mockExtraction } from "@/lib/extract";
import { addPushSub, notifyFamily, removePushSub, sanitizePushSub } from "@/lib/push";
import { addExtraction, createFamily, resetMemoryStore, toView } from "@/lib/store";

const ctx = { language: "en", country: "US", timezone: "UTC", dateOrder: "MDY" as const, currency: "USD", weekStart: 0 as const, childNames: [], todayIso: "2026-11-05" };

describe("backup", () => {
  beforeEach(() => {
    delete process.env.LOCAL_DATA_DIR;
    delete process.env.BLOB_READ_WRITE_TOKEN;
    resetMemoryStore();
  });

  it("exports the list without anything that opens the family, and restores it into a new one", () => {
    const { record } = createFamily();
    record.children = [{ id: "c1c1c1c1", name: "Mia", color: "#2563eb" }];
    const { items } = addExtraction(record, mockExtraction(ctx), "upload", 1);
    items[0].childIds = ["c1c1c1c1"];
    items[1].status = "done";
    const file = JSON.parse(JSON.stringify(exportBackup(record)));
    expect(file.format).toBe(BACKUP_FORMAT);
    for (const secret of ["keyHash", "feedSecret", "hookSecret", "inboundCode", "memberHashes", "push", "gmail"]) expect(secret in file).toBe(false);

    const { record: fresh } = createFamily();
    const res = importBackup(fresh, file);
    expect(res).toMatchObject({ ok: true, children: 1, sources: 1, items: record.items.length });
    expect(fresh.children[0].name).toBe("Mia");
    expect(fresh.children[0].id).not.toBe("c1c1c1c1"); // a new id; the items follow it
    expect(fresh.items.find((i) => i.id === items[0].id)?.childIds).toEqual([fresh.children[0].id]);
    expect(fresh.items.find((i) => i.id === items[1].id)?.status).toBe("done");
    // a second restore adds nothing
    expect(importBackup(fresh, file)).toMatchObject({ ok: true, children: 0, sources: 0, items: 0 });
  });

  it("refuses other shapes and drops what does not belong", () => {
    const { record } = createFamily();
    expect(importBackup(record, null).ok).toBe(false);
    expect(importBackup(record, { format: "x", children: [], sources: [], items: [] }).ok).toBe(false);
    const res = importBackup(record, {
      format: BACKUP_FORMAT,
      children: [{ id: "a", name: "" }],
      sources: [{ id: "abcdef12", title: "T", kind: "nope", ts: "not a date" }],
      items: [
        { id: "111111aa", sourceId: "abcdef12", type: "event", title: "Kept", date: "2026-13-99", time: "25:61", amount: -5, keyHash: "x" },
        { id: "222222aa", sourceId: "ffffffff", type: "event", title: "No such notice" },
        { id: "333333aa", sourceId: "abcdef12", type: "weird", title: "Bad type" },
        { id: "../../etc", sourceId: "abcdef12", type: "event", title: "Bad id" },
      ],
    });
    expect(res).toMatchObject({ ok: true, children: 0, sources: 1, items: 2 }); // the item whose notice is gone still counts
    expect(record.sources[0].kind).toBe("upload");
    expect(record.items[0]).toMatchObject({ title: "Kept", date: null, time: null, amount: null, status: "open" });
    // a restore that would not fit changes nothing
    const before = record.items.length;
    const big = { format: BACKUP_FORMAT, children: [], sources: [], items: [{ id: "444444aa", sourceId: "abcdef12", type: "todo", title: "One more" }] };
    expect(importBackup(record, big, { children: 8, items: before, sources: 400 })).toEqual({ ok: false, reason: "too_many" });
    expect(record.items).toHaveLength(before);
    // asked up front for a restore sent in pieces: ids already there do not count
    const have = record.items.map((i) => i.id);
    expect(backupFits(record, [...have, "444444aa"], [], { items: before, sources: 400 })).toBe(false);
    expect(backupFits(record, have, [], { items: before, sources: 400 })).toBe(true);
    expect(backupFits(record, [...have, "444444aa", "444444aa"], ["abcdef12"], { items: before + 1, sources: 1 })).toBe(true);
    expect("keyHash" in record.items[0]).toBe(false);
  });
});

describe("push", () => {
  it("accepts only a browser subscription to an https push service", () => {
    const good = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) } };
    expect(sanitizePushSub(good)).toMatchObject({ endpoint: good.endpoint });
    expect(sanitizePushSub({ ...good, endpoint: "http://insecure.example/x" })).toBeNull();
    expect(sanitizePushSub({ ...good, endpoint: "not a url" })).toBeNull();
    for (const bad of ["https://169.254.169.254/latest", "https://localhost/x", "https://evil.example/fcm.googleapis.com", "https://fcm.googleapis.com:8443/x", "https://fcm.googleapis.com.evil.example/x"]) expect(sanitizePushSub({ ...good, endpoint: bad })).toBeNull();
    expect(sanitizePushSub({ ...good, endpoint: "https://web.push.apple.com/abc" })).not.toBeNull();
    expect(sanitizePushSub({ ...good, endpoint: "https://updates.push.services.mozilla.com/wpush/v2/abc" })).not.toBeNull();
    expect(sanitizePushSub({ ...good, keys: { p256dh: "short", auth: "a".repeat(22) } })).toBeNull();
    expect(sanitizePushSub(null)).toBeNull();
  });

  it("keeps one entry per device, never shows it to the browser, and sends nothing without keys", async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    const { record } = createFamily();
    const sub = sanitizePushSub({ endpoint: "https://fcm.googleapis.com/fcm/send/1", keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) } })!;
    addPushSub(record, sub);
    addPushSub(record, sub);
    expect(record.push).toHaveLength(1);
    const view = toView(record) as unknown as Record<string, unknown>;
    expect("push" in view).toBe(false);
    expect(view.pushDevices).toBe(1);
    expect(view.pushKey).toBeNull();
    expect(await notifyFamily(record, { title: "t", body: "b", url: "/" })).toBe(0);
    expect(removePushSub(record, sub.endpoint)).toBe(true);
    expect(removePushSub(record, sub.endpoint)).toBe(false);
  });
});

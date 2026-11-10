import { beforeEach, describe, expect, it } from "vitest";
import { activeAnnouncement, isPaused, readAdminActions, readFamilyAdmin, recordAdminAction, removeFamilyAdmin, setAnnouncement, writeFamilyAdmin } from "@/lib/ops";
import { createFamily, resetMemoryStore, saveFamily, toView, writeDoc } from "@/lib/store";
import { base32Decode, base32Encode, newTotpSecret, totpCode, totpUri, verifyTotp } from "@/lib/totp";

describe("one-time codes", () => {
  it("matches the RFC 6238 test vectors (SHA-1, six digits)", () => {
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    expect(totpCode(secret, 59_000)).toBe("287082");
    expect(totpCode(secret, 1111111109_000)).toBe("081804");
    expect(totpCode(secret, 1234567890_000)).toBe("005924");
    expect(base32Decode(secret).toString()).toBe("12345678901234567890");
  });

  it("accepts the current code and its neighbours, nothing else", () => {
    const secret = newTotpSecret();
    const now = 1_800_000_000_000;
    expect(verifyTotp(secret, totpCode(secret, now), now)).toBe(true);
    expect(verifyTotp(secret, ` ${totpCode(secret, now - 30000)} `, now)).toBe(true);
    expect(verifyTotp(secret, totpCode(secret, now - 120000), now)).toBe(false);
    expect(verifyTotp(secret, "12345", now)).toBe(false);
    expect(verifyTotp(secret, null, now)).toBe(false);
    expect(verifyTotp("AB", totpCode("AB", now), now)).toBe(false); // too short to be a secret
    expect(totpUri(secret)).toContain(`secret=${secret}`);
  });
});

describe("announcements, notes and the action log", () => {
  beforeEach(() => {
    delete process.env.LOCAL_DATA_DIR;
    delete process.env.BLOB_READ_WRITE_TOKEN;
    resetMemoryStore();
  });

  it("shows one announcement to the audience it is for, until it ends", async () => {
    expect(await activeAnnouncement("teachers")).toBeNull();
    const a = await setAnnouncement("  Maintenance on Sunday  ", "teachers", 3);
    expect(a?.text).toBe("Maintenance on Sunday");
    expect((await activeAnnouncement("teachers"))?.id).toBe(a?.id);
    expect(await activeAnnouncement("families")).toBeNull();
    expect(await activeAnnouncement("teachers", new Date(Date.now() + 4 * 86400000))).toBeNull();
    await setAnnouncement("For everyone", "all", 500);
    const all = await activeAnnouncement("families");
    expect(all?.text).toBe("For everyone");
    expect(Date.parse(all!.until) - Date.now()).toBeLessThan(61 * 86400000); // capped
    await setAnnouncement("", "all", 1);
    expect(await activeAnnouncement("families")).toBeNull();
  });

  it("keeps the operator's note and pause switch off the browser, and logs each action on its own", async () => {
    const { record } = createFamily();
    await saveFamily(record);
    await writeFamilyAdmin(record.id, { note: "asked about billing" });
    await writeFamilyAdmin(record.id, { blocked: true });
    expect(await readFamilyAdmin(record.id)).toEqual({ note: "asked about billing", blocked: true });
    expect(await isPaused(record.id)).toBe(true);
    // the family document itself knows nothing of it, so saving the family cannot undo it
    await saveFamily(record);
    expect(await isPaused(record.id)).toBe(true);
    expect(JSON.stringify(toView(record))).not.toContain("asked about billing");
    await writeFamilyAdmin(record.id, { blocked: false, note: "" });
    expect(await isPaused(record.id)).toBe(false);
    await removeFamilyAdmin(record.id);
    // a damaged document is an error, never "not paused"
    for (const bad of ["", "null", "{}", "{\"blocked\":\"yes\",\"note\":\"\"}"]) {
      await writeDoc(`familyadmin/${record.id}`, bad);
      await expect(isPaused(record.id)).rejects.toThrow();
    }
    await removeFamilyAdmin(record.id);
    expect(await isPaused(record.id)).toBe(false);
    await Promise.all([recordAdminAction("family_block", record.id, "paused"), recordAdminAction("family_note", record.id, "note saved")]);
    const log = await readAdminActions();
    expect(log.map((l) => l.action).sort()).toEqual(["family_block", "family_note"]);
  });
});

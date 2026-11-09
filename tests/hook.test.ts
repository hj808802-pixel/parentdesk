import { beforeEach, describe, expect, it } from "vitest";
import { createFamily, hookTokenOf, loadFamily, parseHookToken, resetMemoryStore, rotateHook, saveFamily, toView, verifyHookSecret } from "@/lib/store";

describe("device-automation address", () => {
  beforeEach(() => {
    delete process.env.LOCAL_DATA_DIR;
    delete process.env.BLOB_READ_WRITE_TOKEN;
    resetMemoryStore();
  });

  it("gives every family a secret address that parses, verifies, rotates and never leaks", async () => {
    const { record } = createFamily();
    const token = hookTokenOf(record);
    expect(token).toMatch(/^[0-9a-f]{12}_[0-9a-f]{16}$/);
    const parsed = parseHookToken(token)!;
    expect(parsed.id).toBe(record.id);
    expect(verifyHookSecret(record, parsed.secret)).toBe(true);
    expect(verifyHookSecret(record, "0".repeat(16))).toBe(false);
    expect(parseHookToken("nope")).toBeNull();
    expect(parseHookToken(`${record.id}_${"g".repeat(16)}`)).toBeNull();
    const view = toView(record) as unknown as Record<string, unknown>;
    expect(view.hookSecret).toBeUndefined();
    expect(view.hookToken).toBe(token);
    rotateHook(record);
    expect(verifyHookSecret(record, parsed.secret)).toBe(false);
    expect(hookTokenOf(record)).not.toBe(token);
    // records written before the address existed get one when loaded
    const old = { ...record } as Record<string, unknown>;
    delete old.hookSecret;
    await saveFamily(old as unknown as typeof record);
    const loaded = (await loadFamily(record.id))!;
    expect(loaded.hookSecret).toMatch(/^[0-9a-f]{16}$/);
  });
});

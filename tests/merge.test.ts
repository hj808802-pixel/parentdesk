import { beforeEach, describe, expect, it } from "vitest";
import { createFamily, loadFamily, resetMemoryStore, saveFamily } from "@/lib/store";
import { mergeFamily } from "@/lib/merge";
import type { FamilyRecord, Item } from "@/lib/types";

// Two phones in one family load the document, change it, and each write it back. These
// tests prove the later write no longer drops the earlier one's work (lib/merge.ts).

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

function item(id: string, over: Partial<Item> = {}): Item {
  return {
    id,
    sourceId: "s1",
    type: "event",
    title: id,
    description: "",
    date: "2026-11-20",
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
    childIds: [],
    status: "open",
    createdAt: "2026-11-10T00:00:00.000Z",
    updatedAt: "2026-11-10T00:00:00.000Z",
    ...over,
  };
}

describe("mergeFamily", () => {
  const base = (): FamilyRecord => createFamily({ locale: "en" }).record;

  it("keeps a field each side changed and sums counters", () => {
    const b = base();
    b.usage = { "2026-11": 3 };
    const mine = clone(b);
    const theirs = clone(b);
    mine.settings.familyName = "Lee"; // this phone renamed the family
    theirs.settings.language = "ko"; // the other phone switched language
    mine.usage["2026-11"] = 4; // each extracted one more notice
    theirs.usage["2026-11"] = 4;
    const out = mergeFamily(b, mine, theirs);
    expect(out.settings.familyName).toBe("Lee");
    expect(out.settings.language).toBe("ko");
    expect(out.usage["2026-11"]).toBe(5); // 3 + 1 + 1
  });

  it("keeps notices and items added on either side", () => {
    const b = base();
    const mine = clone(b);
    const theirs = clone(b);
    mine.items.push(item("i-mine"));
    theirs.items.push(item("i-theirs"));
    const out = mergeFamily(b, mine, theirs);
    expect(out.items.map((i) => i.id).sort()).toEqual(["i-mine", "i-theirs"]);
  });

  it("takes the newer edit of the same item", () => {
    const b = base();
    b.items = [item("x", { title: "old", updatedAt: "2026-11-10T00:00:00.000Z" })];
    const mine = clone(b);
    const theirs = clone(b);
    mine.items[0] = item("x", { title: "mine", updatedAt: "2026-11-11T09:00:00.000Z" });
    theirs.items[0] = item("x", { title: "theirs", updatedAt: "2026-11-11T10:00:00.000Z" });
    expect(mergeFamily(b, mine, theirs).items[0].title).toBe("theirs");
  });

  it("honours a delete only when the other side left the item alone", () => {
    const b = base();
    b.items = [item("keep"), item("drop")];
    // mine deletes both; theirs edits "keep" and leaves "drop" untouched
    const mine = clone(b);
    mine.items = [];
    const theirs = clone(b);
    theirs.items = [item("keep", { title: "edited", updatedAt: "2026-11-12T00:00:00.000Z" }), item("drop")];
    const out = mergeFamily(b, mine, theirs);
    const ids = out.items.map((i) => i.id);
    expect(ids).toContain("keep"); // their edit beats my delete
    expect(ids).not.toContain("drop"); // untouched on their side: my delete stands
  });
});

describe("saveFamily concurrency", () => {
  beforeEach(() => {
    delete process.env.LOCAL_DATA_DIR;
    delete process.env.BLOB_READ_WRITE_TOKEN;
    resetMemoryStore();
  });

  it("does not drop the first device's change when the second saves over it", async () => {
    const { record } = createFamily({ locale: "en" });
    record.items = [item("base-item")];
    await saveFamily(record);

    const a = (await loadFamily(record.id))!; // partner A's phone
    const b = (await loadFamily(record.id))!; // partner B's phone, loaded at the same version

    a.children.push({ id: "c1", name: "Mia", color: "#2563eb" });
    a.items.push(item("from-a", { date: "2026-11-21" }));
    await saveFamily(a);

    b.settings.familyName = "Lee";
    b.items.push(item("from-b", { date: "2026-11-22" }));
    await saveFamily(b); // lands on top of A's write -> must merge, not overwrite

    const after = (await loadFamily(record.id))!;
    expect(after.children.map((c) => c.name)).toContain("Mia"); // A's child survived
    expect(after.settings.familyName).toBe("Lee"); // B's rename survived
    expect(after.items.map((i) => i.id).sort()).toEqual(["base-item", "from-a", "from-b"]);
    expect(after.rev).toBe(2); // two writes after the create
  });

  it("bumps the version and keeps both of two saves in the same request", async () => {
    const { record } = createFamily({ locale: "en" });
    await saveFamily(record);
    const start = record.rev ?? 0;
    const loaded = (await loadFamily(record.id))!;
    loaded.settings.familyName = "First";
    await saveFamily(loaded);
    loaded.settings.country = "KR";
    await saveFamily(loaded); // a second save in the same request starts from a fresh baseline
    const after = (await loadFamily(record.id))!;
    expect(after.settings.familyName).toBe("First");
    expect(after.settings.country).toBe("KR");
    expect(after.rev).toBe(start + 2); // the version climbs once per write
  });
});

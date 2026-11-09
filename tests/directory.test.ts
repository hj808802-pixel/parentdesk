import { beforeEach, describe, expect, it } from "vitest";
import {
  createRoom,
  createTeacher,
  forgetSchoolIfUnused,
  joinCodeOf,
  loadDirectory,
  loadSchools,
  matchDirectory,
  normalizeCode,
  rebuildDirectory,
  rememberSchool,
  removeFromDirectory,
  schoolIdOf,
  searchSchools,
  roomPublic,
  roomView,
  rotateJoinSecret,
  saveRoom,
  saveTeacher,
  searchDirectory,
  syncDirectory,
  touchDirectory,
  verifyJoinCode,
} from "@/lib/rooms";
import { resetMemoryStore, writeDoc } from "@/lib/store";

describe("class code and directory", () => {
  beforeEach(() => {
    delete process.env.LOCAL_DATA_DIR;
    delete process.env.BLOB_READ_WRITE_TOKEN;
    resetMemoryStore();
  });

  it("derives a six-character class code that rotates with the link and forgives how it is typed", () => {
    const { record: teacher } = createTeacher({ name: "T", school: "Oak" });
    const room = createRoom(teacher, "Room 12")!;
    const code = joinCodeOf(room);
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/); // no 0/O or 1/I
    expect(joinCodeOf(room)).toBe(code); // stable: nothing stored
    expect(verifyJoinCode(room, code.toLowerCase())).toBe(true);
    expect(verifyJoinCode(room, ` ${code.slice(0, 3)}-${code.slice(3)} `)).toBe(true);
    expect(verifyJoinCode(room, code.slice(0, 5))).toBe(false);
    expect(verifyJoinCode(room, "")).toBe(false);
    expect(verifyJoinCode(room, null)).toBe(false);
    expect(normalizeCode("ab 0o-1i")).toHaveLength(6);
    rotateJoinSecret(room);
    expect(joinCodeOf(room)).not.toBe(code);
    expect(roomView(room).joinCode).toBe(joinCodeOf(room));
    expect("joinSecret" in roomView(room)).toBe(false);
  });

  it("lists only rooms the teacher chose to list, finds them by school and class, and keeps nothing about families", async () => {
    const { record: teacher } = createTeacher({ name: "Ms. Kim", school: "Hanbit Elementary", region: "서울", city: "강남구", locale: "ko" });
    const a = createRoom(teacher, "3-2", { grade: "3", classLabel: "2", listed: true })!;
    const b = createRoom(teacher, "Chess club", { listed: false })!;
    const { record: noSchool } = createTeacher({ name: "X" });
    const c = createRoom(noSchool, "Room", { listed: true })!;
    expect(c.listed).toBe(false); // listing needs a school name
    await saveTeacher(teacher);
    await saveRoom(a);
    await saveRoom(b);
    await syncDirectory(teacher, [a, b]);
    const entries = await loadDirectory(true);
    expect(entries.map((e) => e.id)).toEqual([a.id]);
    expect(entries[0]).toMatchObject({ school: "Hanbit Elementary", region: "서울", city: "강남구", grade: "3", classLabel: "2", teacherName: "Ms. Kim", country: "KR", members: 0, lastPostAt: null });
    expect(entries[0].schoolId).toHaveLength(12);
    expect(searchDirectory(entries, "hanbit 3").map((h) => h.id)).toEqual([a.id]);
    expect(searchDirectory(entries, "강남 hanbit").map((h) => h.id)).toEqual([a.id]); // the place counts too
    expect(searchDirectory(entries, "부산 hanbit")).toEqual([]);
    expect(searchDirectory(entries, "han bit")).toHaveLength(1);
    expect(searchDirectory(entries, "HANBIT ELEMENTARY 3 2")).toHaveLength(1);
    expect(searchDirectory(entries, "hanbit 4")).toEqual([]);
    expect(searchDirectory(entries, "")).toEqual([]);
    expect(searchDirectory(entries, "hanbit", "JP")).toEqual([]);
    expect(searchDirectory(entries, "hanbit", "KR")).toHaveLength(1);
    expect("teacherId" in searchDirectory(entries, "hanbit")[0]).toBe(false);
    // a family joins: the count follows without touching anything else
    a.members.push({ familyId: "f".repeat(12), joinedAt: new Date().toISOString() });
    await touchDirectory(a);
    expect((await loadDirectory(true))[0].members).toBe(1);
    // another teacher's room lands beside it, each written on its own
    const { record: other } = createTeacher({ name: "Mr. Lee", school: "Hanbit Elementary" });
    const d = createRoom(other, "5-1", { grade: "5", classLabel: "1", listed: true })!;
    await saveTeacher(other);
    await saveRoom(d);
    await syncDirectory(other, [d]);
    expect((await loadDirectory(true)).map((e) => e.id).sort()).toEqual([a.id, d.id].sort());
    // unlisting takes it out; listing again and rebuilding puts it back
    a.listed = false;
    await saveRoom(a);
    await syncDirectory(teacher, [a]);
    expect((await loadDirectory(true)).map((e) => e.id)).toEqual([d.id]);
    a.listed = true;
    await saveRoom(a);
    expect((await rebuildDirectory()).map((e) => e.id).sort()).toEqual([a.id, d.id].sort());
    await removeFromDirectory([a.id, d.id]);
    expect(await loadDirectory(true)).toEqual([]);
  });

  it("keeps one entry per school and place, however the name was typed", async () => {
    const { record: a } = createTeacher({ name: "A", school: " Hanbit  Elementary ", region: "서울", city: "강남구", locale: "ko" });
    const { record: b } = createTeacher({ name: "B", school: "hanbit elementary", region: "서울", city: "강남 구", locale: "ko" });
    const { record: c } = createTeacher({ name: "C", school: "Hanbit Elementary", region: "부산", city: "", locale: "ko" });
    expect(schoolIdOf(a)).toBe(schoolIdOf(b));
    expect(schoolIdOf(a)).not.toBe(schoolIdOf(c));
    expect(schoolIdOf({ ...a, school: "" })).toBe("");
    await saveTeacher(b);
    await saveTeacher(c); // the teacher scan in forgetSchoolIfUnused only sees saved teachers
    await rememberSchool(a);
    await rememberSchool(b);
    await rememberSchool(c);
    const schools = await loadSchools(true);
    expect(schools).toHaveLength(2);
    // a listed room makes the school rank first and shows in its count
    const room = createRoom(a, "3-1", { grade: "3", classLabel: "1", listed: true })!;
    await saveTeacher(a);
    await saveRoom(room);
    await syncDirectory(a, [room]);
    const hits = searchSchools(schools, await loadDirectory(true), "hanbit", "KR");
    expect(hits.map((h) => [h.region, h.rooms])).toEqual([
      ["서울", 1],
      ["부산", 0],
    ]);
    expect(searchSchools(schools, [], "hanbit 강남")).toHaveLength(1);
    expect(searchSchools(schools, [], "hanbit", "JP")).toEqual([]);
    // exact class match for the teacher desk, whatever the spacing or case
    expect(matchDirectory(await loadDirectory(true), schoolIdOf(a), " 3 ", "1").map((h) => h.id)).toEqual([room.id]);
    expect(matchDirectory(await loadDirectory(true), schoolIdOf(a), "3", "2")).toEqual([]);
    expect(matchDirectory(await loadDirectory(true), schoolIdOf(a), "3", "")).toEqual([]); // an empty class is not a wildcard
    expect(matchDirectory(await loadDirectory(true), schoolIdOf(a))).toHaveLength(1); // the whole school
    // the Busan entry: its teacher still names it, so it stays; once nobody does, it goes
    await forgetSchoolIfUnused(schoolIdOf(c));
    expect((await loadSchools(true)).map((s) => s.region).sort()).toEqual(["부산", "서울"]);
    c.school = "";
    await saveTeacher(c);
    await forgetSchoolIfUnused(schoolIdOf({ ...c, school: "Hanbit Elementary" }));
    await forgetSchoolIfUnused(schoolIdOf(a)); // still listed: stays
    expect((await loadSchools(true)).map((s) => s.region)).toEqual(["서울"]);
  });

  it("recovers what was written before places existed", async () => {
    // a directory entry without a school id gets one from its own fields
    const { record: t } = createTeacher({ name: "T", school: "Oak", region: "", city: "", locale: "en" });
    await writeDoc("directory/aaaaaaaaaaaa", JSON.stringify({ id: "aaaaaaaaaaaa", teacherId: t.id, school: "Oak", grade: "", classLabel: "", name: "R", teacherName: "T", country: "US", members: 0, updatedAt: new Date().toISOString() }));
    const [entry] = await loadDirectory(true);
    expect(entry.schoolId).toBe(schoolIdOf(t));
    expect(entry.region).toBe("");
    // the school registry is built from the teachers once, even when a school was saved first
    await saveTeacher(t);
    const { record: u } = createTeacher({ name: "U", school: "Pine", locale: "en" });
    await saveTeacher(u);
    await rememberSchool(u); // one entry already there, no marker yet
    expect((await loadSchools(true)).map((s) => s.name).sort()).toEqual(["Oak", "Pine"]);
  });

  it("shows grade and class to parents and keeps them short", () => {
    const { record: teacher } = createTeacher({ name: "T", school: "Oak" });
    const room = createRoom(teacher, "R", { grade: "  3  ", classLabel: "x".repeat(40), listed: true })!;
    expect(room.grade).toBe("3");
    expect(room.classLabel).toHaveLength(20);
    expect(roomPublic(room, teacher)).toMatchObject({ grade: "3", listed: true, school: "Oak", region: "", city: "" });
    expect(roomPublic(room, null).listed).toBe(false);
  });
});

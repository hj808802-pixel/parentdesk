// End-to-end launch test: every main flow of the three surfaces (family, teacher, admin)
// from first visit to clean-up, with REAL model calls. Local server only.
//
//   ADMIN_TOKEN=<a test token> npm run dev -- -p 3002     (with ANTHROPIC_API_KEY set)
//   node scripts/e2e.mjs --url http://localhost:3002 --admin <the same test token>
//
// Everything it creates (two families, a teacher, a room, an admin account, an
// announcement) is removed again at the end. Never point it at production.
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const BASE = arg("url", "http://localhost:3002");
const ADMIN = arg("admin", "");
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) {
  console.error("e2e runs against a local server only");
  process.exit(2);
}

let pass = 0;
const failed = [];
const notes = [];
function ok(name, cond, detail = "") {
  if (cond) pass++;
  else failed.push(`${name}${detail ? ` — ${String(detail).slice(0, 220)}` : ""}`);
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${!cond && detail ? ` — ${String(detail).slice(0, 220)}` : ""}`);
}
function client() {
  const jar = {};
  return async function call(method, path, { json, form, raw } = {}) {
    const headers = {};
    const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.cookie = cookie;
    let body;
    if (json !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(json);
    } else if (form) body = form;
    else if (raw !== undefined) body = raw;
    const res = await fetch(`${BASE}${path}`, { method, headers, body, redirect: "manual" });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(";");
      const [k, ...v] = pair.split("=");
      if (v.join("=")) jar[k] = v.join("=");
      else delete jar[k];
    }
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      /* not json */
    }
    return { status: res.status, data, text, headers: res.headers };
  };
}
const fd = (fields) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const NOTICE_KO = `[3학년 2반 가정통신문]
안녕하세요, 학부모님. 다음 주 일정 안내드립니다.
1. 현장체험학습: ${day(9)} 오전 9시 과학관. 도시락과 물통을 준비해 주세요.
2. 참가비 12,000원을 ${day(5)}까지 스쿨뱅킹으로 납부해 주세요.
3. 참가 동의서를 ${day(4)}까지 담임에게 제출해 주세요.
4. 매주 월요일은 도서관 책 반납일입니다.
문의: 담임 김민수`;

const health = await (await fetch(`${BASE}/api/health`)).json();
console.log(`\n== server: model key ${health.hasKey}, mock ${health.mock}, storage ${health.storage}\n`);
if (health.storage !== "local") {
  console.error(`storage is "${health.storage}": this test writes and deletes data, so it only runs against a server that keeps its data in local files (LOCAL_DATA_DIR)`);
  process.exit(2);
}
if (health.mock) notes.push("the server is in demo mode: model answers are canned, so the content checks are weaker");

// ---------------------------------------------------------------- family
console.log("== family");
const fam = client();
const first = await fam("POST", "/api/extract", { form: fd({ text: NOTICE_KO, locale: "ko", timezone: "Asia/Seoul" }) });
ok("first notice creates a family and items", first.status === 200 && first.data?.family?.items?.length >= 3, `${first.status} ${first.text.slice(0, 200)}`);
let family = first.data?.family;
const items = family?.items ?? [];
ok("the family got a key once", /^pd_[0-9a-f]{12}_[0-9a-f]{24}$/.test(first.data?.key ?? ""));
ok("items carry dates", items.filter((i) => i.date).length >= 3, JSON.stringify(items.map((i) => i.date)));
ok("a payment with an amount was found", items.some((i) => i.type === "payment" && (health.mock ? i.amount > 0 : i.amount === 12000)), JSON.stringify(items.map((i) => [i.type, i.amount])));
ok("a consent form was found", items.some((i) => i.type === "consent"), JSON.stringify(items.map((i) => i.type)));
ok("things to bring were found", items.some((i) => i.bring?.length >= 1), JSON.stringify(items.map((i) => i.bring)));
if (!health.mock) ok("the weekly library day is marked as repeating", items.some((i) => i.recurrence === "weekly"), JSON.stringify(items.map((i) => i.recurrence)));
ok("the notice is on the notices list", family?.sources?.length === 1 && family.sources[0].kind === "paste");

const kids = await fam("PATCH", "/api/family", { json: { settings: { familyName: "E2E 가족", members: ["엄마", "아빠"] }, children: [{ id: "new-1", name: "민준", color: "#2563eb" }, { id: "new-2", name: "서연", color: "#db2777" }] } });
ok("settings and two children are saved", kids.status === 200 && kids.data.family.children.length === 2 && kids.data.family.settings.members.length === 2, kids.text.slice(0, 160));
family = kids.data.family;
const childId = family.children[0].id;

const trip = items.find((i) => i.type === "event") ?? items[0];
const pay = items.find((i) => i.type === "payment") ?? items[1];
const tagged = await fam("PATCH", `/api/items/${trip.id}`, { json: { childIds: [childId], owner: "엄마" } });
ok("an item can be tagged with a child and an owner", tagged.status === 200 && tagged.data.item.childIds[0] === childId && tagged.data.item.owner === "엄마", tagged.text.slice(0, 160));
const done = await fam("PATCH", `/api/items/${pay.id}`, { json: { status: "done" } });
ok("an item can be ticked off", done.status === 200 && done.data.item.status === "done");
const undone = await fam("PATCH", `/api/items/${pay.id}`, { json: { status: "open" } });
ok("and opened again", undone.status === 200 && undone.data.item.status === "open");
const rec = items.find((i) => i.recurrence);
if (rec) {
  const rolled = await fam("PATCH", `/api/items/${rec.id}`, { json: { status: "done" } });
  ok("ticking a repeating item creates the next one", rolled.status === 200 && rolled.data.next && rolled.data.next.date > (rec.date ?? ""), JSON.stringify(rolled.data?.next ?? null).slice(0, 160));
}
const edited = await fam("PATCH", `/api/items/${trip.id}`, { json: { title: "과학관 현장체험학습(수정)", time: "09:30" } });
ok("title and time can be edited", edited.status === 200 && edited.data.item.time === "09:30" && edited.data.item.title.includes("수정"), edited.text.slice(0, 160));

const asked = await fam("POST", "/api/ask", { json: { question: "이번에 낼 돈이 얼마예요?" } });
ok("ask answers from the list", asked.status === 200 && asked.data.answer.length > 5 && (health.mock || /12[,.]?000/.test(asked.data.answer)), asked.text.slice(0, 200));
const explained = await fam("POST", `/api/items/${pay.id}/explain`);
ok("explain gives an explanation and steps", explained.status === 200 && explained.data.explanation.length > 10 && Array.isArray(explained.data.what_to_do), explained.text.slice(0, 160));
const reply = await fam("POST", `/api/items/${trip.id}/reply`, { json: { intent: "yes", note: "" } });
ok("a reply draft is written", reply.status === 200 && reply.data.reply.length > 10, reply.text.slice(0, 160));
const setup = await fam("POST", "/api/family/assist-settings", { json: { text: "한 주를 월요일부터 시작해줘", locale: "ko" } });
ok("say-it settings proposes a change", setup.status === 200 && (health.mock || setup.data.settings.weekStartsOn === "monday"), setup.text.slice(0, 200));

const view = (await fam("GET", "/api/family")).data.family;
const feed = await fetch(`${BASE}/api/calendar/${view.feedToken}.ics`);
const ics = await feed.text();
ok("the calendar feed is a calendar with events", feed.status === 200 && ics.startsWith("BEGIN:VCALENDAR") && (ics.match(/BEGIN:VEVENT/g) ?? []).length >= 3, ics.slice(0, 120));
ok("the feed has reminders", /BEGIN:VALARM/.test(ics));
ok("a wrong feed address gives nothing", (await fetch(`${BASE}/api/calendar/${view.id}_${"0".repeat(16)}.ics`)).status === 404);
const rot = await fam("POST", "/api/family/rotate-feed");
ok("a new feed address replaces the old one", rot.status === 200 && rot.data.family.feedToken !== view.feedToken && (await fetch(`${BASE}/api/calendar/${view.feedToken}.ics`)).status === 404);

const ping = await fetch(`${BASE}/api/hook/${view.hookToken}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ping: true }) });
ok("the automation address answers a ping", ping.status === 200 && (await ping.json()).ping === true);
const junk = await fetch(`${BASE}/api/hook/${view.hookToken}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "[Web발신] 고객님 택배가 오늘 도착 예정입니다. 배송조회는 앱에서 확인하세요.", from: "택배" }) });
const junkBody = await junk.json();
ok("a message that is not from a school is dropped", junk.status === 200 && (health.mock || junkBody.saved === false), JSON.stringify(junkBody).slice(0, 160));
const sms = await fetch(`${BASE}/api/hook/${view.hookToken}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: `[한빛초 3-2] 내일(${day(1)}) 체육복을 입혀 보내 주세요. 실내화도 챙겨 주세요.`, from: "한빛초" }) });
const smsBody = await sms.json();
ok("a school text message becomes an item", sms.status === 200 && (health.mock || smsBody.saved === true), JSON.stringify(smsBody).slice(0, 200));

const invite = await fam("POST", "/api/family/invite", { json: { locale: "ko" } });
if (invite.status === 429) {
  console.error("the server's hourly limiter is used up (another check ran against it): restart the dev server and run this again");
  process.exit(2);
}
ok("an invite link is made", invite.status === 200 && /\/join\?i=/.test(invite.data?.url ?? ""), invite.text.slice(0, 120));
const partner = client();
const joined = await partner("POST", "/api/family/join", { json: { invite: new URL(invite.data?.url ?? "http://x/").searchParams.get("i") } });
ok("the partner joins with it and sees the same list", joined.status === 200 && joined.data.family.id === view.id && joined.data.key !== first.data.key, joined.text.slice(0, 120));
ok("the partner's own key opens the family", (await partner("GET", "/api/family")).status === 200);

const backup = await fam("GET", "/api/family/export");
ok("a backup downloads without secrets", backup.status === 200 && backup.data.format === "parentdesk-backup" && !/keyHash|feedSecret|hookSecret/.test(backup.text));
const stale = (await fam("GET", "/api/family")).data.family.items.filter((i) => i.status === "open").map((i) => i.id).slice(0, 2);
const bulk = await fam("POST", "/api/items/bulk", { json: { ids: stale, status: "dismissed" } });
ok("several items can be cleared at once", bulk.status === 200 && bulk.data.changed === stale.length, bulk.text.slice(0, 120));
const del = await fam("DELETE", `/api/items/${trip.id}`);
ok("an item can be deleted", del.status === 200);
const fresh = client();
await fresh("POST", "/api/family", { json: { locale: "ko", timezone: "Asia/Seoul" } });
const restored = await fresh("POST", "/api/family/import", { raw: backup.text });
ok("the backup restores into a new family", restored.status === 200 && restored.data.restored.items === backup.data.items.length && restored.data.family.children.length === 2, restored.text.slice(0, 160));
ok("push is refused without a real subscription", [400, 503].includes((await fam("POST", "/api/push", { json: { subscription: { endpoint: "https://evil.example/x", keys: { p256dh: "a", auth: "b" } } } })).status));

// ---------------------------------------------------------------- teacher and class rooms
console.log("\n== teacher and class rooms");
const tea = client();
const tCreate = await tea("POST", "/api/teacher", { json: { name: "E2E 선생님", school: "이투이초등학교", region: "서울", city: "테스트구", locale: "ko", timezone: "Asia/Seoul" } });
ok("a teacher desk is created with a key", tCreate.status === 200 && /^pdt_/.test(tCreate.data.key ?? ""), tCreate.text.slice(0, 160));
const roomRes = await tea("POST", "/api/teacher/rooms", { json: { name: "", grade: "3", classLabel: "2", listed: true } });
ok("a room needs a name on the server (the page fills it from grade and class)", roomRes.status === 400);
const roomOk = await tea("POST", "/api/teacher/rooms", { json: { name: "3학년 2반", grade: "3", classLabel: "2", listed: true } });
const room = roomOk.data?.teacher?.rooms?.[0];
ok("a listed room is opened with a class code", roomOk.status === 200 && room?.listed === true && /^[A-HJ-NP-Z2-9]{6}$/.test(room.joinCode), roomOk.text.slice(0, 200));
const school = await fetch(`${BASE}/api/schools/search?q=${encodeURIComponent("이투이초")}&country=KR`).then((r) => r.json());
ok("the school shows up for other teachers to pick", school.schools?.some((s) => s.name === "이투이초등학교" && s.region === "서울" && s.rooms === 1), JSON.stringify(school).slice(0, 200));
const dup = await fetch(`${BASE}/api/rooms/search?schoolId=${roomOk.data.teacher.schoolId}&grade=3&classLabel=2`).then((r) => r.json());
ok("the same class is found for the duplicate warning", dup.rooms?.length === 1 && dup.rooms[0].id === room.id);
const found = await fetch(`${BASE}/api/rooms/search?q=${encodeURIComponent("테스트구 이투이초 3")}&country=KR`).then((r) => r.json());
ok("parents find the class by place, school and grade", found.rooms?.some((h) => h.id === room.id && h.city === "테스트구"), JSON.stringify(found).slice(0, 200));

const wrong = await fam("POST", "/api/rooms/join", { json: { roomId: room.id, code: "ZZZZZZ", childIds: [childId] } });
ok("a wrong class code is refused", wrong.status === 403 && wrong.data.error === "bad_code");
const joinRoom = await fam("POST", "/api/rooms/join", { json: { roomId: room.id, code: room.joinCode.toLowerCase(), childIds: [childId] } });
ok("the right code joins, with the child attached", joinRoom.status === 200 && joinRoom.data.family.rooms.some((r) => r.roomId === room.id && r.childIds[0] === childId && /서울/.test(r.place ?? "")), joinRoom.text.slice(0, 200));
const en = client();
await en("POST", "/api/family", { json: { locale: "en", timezone: "America/New_York" } });
const joinLink = await en("POST", "/api/rooms/join", { json: { token: room.joinToken, childIds: [] } });
ok("another family joins by the link, no code needed", joinLink.status === 200 && joinLink.data.family.rooms.length === 1, joinLink.text.slice(0, 160));

const composed = await tea("POST", `/api/teacher/rooms/${room.id}/compose`, { json: { kind: "trip", facts: `과학관 현장학습 ${day(12)} 9시 출발, 참가비 8000원 ${day(8)}까지, 도시락`, tone: "friendly" } });
ok("the notice writer writes a notice", composed.status === 200 && composed.data.notice.length > 40, composed.text.slice(0, 160));
const preview = await tea("POST", `/api/teacher/rooms/${room.id}/post`, { form: fd({ mode: "preview", text: composed.data?.notice ?? NOTICE_KO }) });
const draft = preview.data?.draft;
ok("a notice is read into a draft first", preview.status === 200 && preview.data.preview === true && draft?.items?.length >= 2, preview.text.slice(0, 200));
ok("nothing reached the families yet", !(await fam("GET", "/api/family")).data.family.sources.some((s) => s.kind === "room"));
const sent = await tea("POST", `/api/teacher/rooms/${room.id}/drafts/${draft.id}`, { json: { drop: [], targets: [] } });
ok("sending delivers to both families", sent.status === 200 && sent.data.delivered === 2, sent.text.slice(0, 200));
const famAfter = (await fam("GET", "/api/family")).data.family;
const roomSource = famAfter.sources.find((s) => s.kind === "room");
ok("the Korean family has the notice, tagged with the child", Boolean(roomSource) && famAfter.items.some((i) => i.sourceId === roomSource.id && i.childIds.includes(childId)), JSON.stringify(roomSource ?? null).slice(0, 160));
const enAfter = (await en("GET", "/api/family")).data.family;
const enItems = enAfter.items.filter((i) => enAfter.sources.some((s) => s.kind === "room" && s.id === i.sourceId));
ok("the English family got it in English", enItems.length >= 2 && (health.mock || enItems.every((i) => !/[가-힣]/.test(i.title))), JSON.stringify(enItems.map((i) => i.title)).slice(0, 200));
const roomItem = famAfter.items.find((i) => i.sourceId === roomSource?.id);
await fam("PATCH", `/api/items/${roomItem.id}`, { json: { status: "done" } });
const tally = (await tea("GET", "/api/teacher")).data.teacher.rooms[0].posts[0].tally ?? {};
ok("the teacher sees how many ticked it off, as a count", Object.values(tally).some((t) => t.done === 1), JSON.stringify(tally));
const helped = await tea("POST", "/api/teacher/translate", { json: { text: "Hola, mi hija estará ausente mañana por una cita médica. ¿Qué tarea debe hacer?" } });
ok("the parent-message helper translates and drafts a reply", helped.status === 200 && helped.data.translation.length > 5 && helped.data.reply.length > 5, helped.text.slice(0, 160));
const qr = await tea("GET", `/api/teacher/rooms/${room.id}/qr?l=ko`);
ok("the QR code is drawn", qr.status === 200 && qr.text.startsWith("<svg"));
const dirHit = (await fetch(`${BASE}/api/rooms/search?q=${encodeURIComponent("이투이초")}`).then((r) => r.json())).rooms.find((h) => h.id === room.id);
ok("the search shows two followers and a last notice", dirHit?.members === 2 && Boolean(dirHit.lastPostAt), JSON.stringify(dirHit ?? null).slice(0, 160));
const recalled = await tea("DELETE", `/api/teacher/rooms/${room.id}/posts/${sent.data.post.id}`);
ok("recalling takes the notice back from both families", recalled.status === 200 && recalled.data.families === 2 && !(await fam("GET", "/api/family")).data.family.sources.some((s) => s.kind === "room"), recalled.text.slice(0, 160));
const rotated = await tea("PATCH", `/api/teacher/rooms/${room.id}`, { json: { rotate: true } });
ok("a new link also changes the class code", rotated.status === 200 && rotated.data.teacher.rooms[0].joinCode !== room.joinCode);
ok("the old code no longer joins", (await client()("POST", "/api/rooms/join", { json: { roomId: room.id, code: room.joinCode, childIds: [] } })).status === 403);
const left = await en("DELETE", `/api/rooms/${room.id}`);
ok("a family can leave the room", left.status === 200 && left.data.family.rooms.length === 0);

// ---------------------------------------------------------------- admin console
console.log("\n== admin console");
if (!ADMIN) {
  notes.push("admin flows skipped: pass --admin <test token> (and start the server with the same ADMIN_TOKEN)");
} else {
  const adm = client();
  ok("a wrong token is refused", (await client()("POST", "/api/admin/login", { json: { token: "definitely-wrong-token" } })).status === 401);
  const login = await adm("POST", "/api/admin/login", { json: { token: ADMIN } });
  ok("the owner signs in", login.status === 200 && login.data.me?.role === "owner", login.text.slice(0, 120));
  const stats = await adm("GET", "/api/admin/stats");
  ok("stats: families, rooms, search, usage", stats.status === 200 && stats.data.stats.families.total >= 3 && stats.data.rooms.rooms >= 1 && stats.data.search.listedRooms >= 1 && typeof stats.data.usage.models === "object", stats.text.slice(0, 160));
  if (!health.mock) ok("usage recorded real calls for two or more models", Object.keys(stats.data.usage.models).length >= 2 && Object.values(stats.data.usage.models).every((t) => t.calls > 0 && t.input > 0 && t.output > 0), JSON.stringify(stats.data.usage.models).slice(0, 240));
  const list = await adm("GET", "/api/admin/list");
  const row = list.data?.families?.find((f) => f.id === view.id);
  ok("lists: the family row has counts and no personal content", Boolean(row) && row.children === 2 && !/민준|서연|과학관/.test(JSON.stringify(list.data.families)), JSON.stringify(row ?? null).slice(0, 200));
  ok("lists: the teacher and the room are there", list.data.teachers.some((t) => t.id === tCreate.data.teacher.id) && list.data.rooms.some((r) => r.id === room.id && r.members === 1));
  const sum = await adm("GET", `/api/admin/stats?family=${view.id}`);
  ok("one family's summary", sum.status === 200 && sum.data.family.children === 2 && !/민준|서연/.test(sum.text));

  ok("pause the family", (await adm("POST", "/api/admin/action", { json: { action: "family_block", id: view.id, blocked: true } })).status === 200);
  ok("a paused family cannot ask, but still sees its list", (await fam("POST", "/api/ask", { json: { question: "뭐가 남았어요?" } })).status === 403 && (await fam("GET", "/api/family")).status === 200);
  ok("a paused family cannot add a notice", (await fam("POST", "/api/extract", { form: fd({ text: NOTICE_KO }) })).status === 403);
  ok("resume the family", (await adm("POST", "/api/admin/action", { json: { action: "family_block", id: view.id, blocked: false } })).status === 200 && (await fam("POST", "/api/ask", { json: { question: "뭐가 남았어요?" } })).status === 200);
  ok("a note is kept for the operator only", (await adm("POST", "/api/admin/action", { json: { action: "family_note", id: view.id, note: "e2e note" } })).status === 200 && !(await fam("GET", "/api/family")).text.includes("e2e note") && (await adm("GET", "/api/admin/list")).data.families.find((f) => f.id === view.id).note === "e2e note");
  ok("usage reset", (await adm("POST", "/api/admin/action", { json: { action: "family_reset_usage", id: view.id } })).status === 200 && (await adm("GET", "/api/admin/list")).data.families.find((f) => f.id === view.id).monthUsage === 0);

  ok("pause the teacher with a reason", (await adm("POST", "/api/admin/action", { json: { action: "teacher_block", id: tCreate.data.teacher.id, blocked: true, reason: "e2e 점검" } })).status === 200);
  const pausedDesk = await tea("GET", "/api/teacher");
  ok("the teacher sees the reason and cannot post", pausedDesk.data.paused?.reason === "e2e 점검" && (await tea("POST", `/api/teacher/rooms/${room.id}/post`, { form: fd({ mode: "preview", text: NOTICE_KO }) })).status === 403, JSON.stringify(pausedDesk.data.paused));
  ok("resume the teacher", (await adm("POST", "/api/admin/action", { json: { action: "teacher_block", id: tCreate.data.teacher.id, blocked: false } })).status === 200 && (await tea("GET", "/api/teacher")).data.paused === null);

  const before = (await adm("GET", "/api/admin/list")).data?.announcement ?? null;
  if (before) {
    console.error("an announcement is already published on this server; take it down first (the test would replace and then remove it)");
    process.exit(2);
  }
  const ann = await adm("POST", "/api/admin/action", { json: { action: "announce", text: "E2E 점검 공지입니다.", audience: "teachers", days: 1, translate: true } });
  const seen = (lang, who) => fetch(`${BASE}/api/announcement?for=${who}&locale=${lang}`).then((r) => r.json()).then((b) => b.announcement?.text ?? null);
  ok("an announcement goes to teachers only, translated", ann.status === 200 && (await seen("ko", "teachers")) === "E2E 점검 공지입니다." && (await seen("ko", "families")) === null && (health.mock || !/[가-힣]/.test((await seen("en", "teachers")) ?? "가")), JSON.stringify([await seen("en", "teachers")]));
  ok("and is taken down", (await adm("POST", "/api/admin/action", { json: { action: "announce", text: "" } })).status === 200 && (await seen("ko", "teachers")) === null);

  const made = await adm("POST", "/api/admin/action", { json: { action: "admin_add", name: "e2eviewer", role: "viewer", twoStep: false } });
  ok("a viewer account is made, its token shown once", made.status === 200 && made.data.account.token.length >= 30, made.text.slice(0, 120));
  const viewer = client();
  const vLogin = await viewer("POST", "/api/admin/login", { json: { token: made.data.account.token } });
  ok("the viewer signs in and can look", vLogin.status === 200 && vLogin.data.me.role === "viewer" && (await viewer("GET", "/api/admin/stats")).status === 200 && (await viewer("GET", "/api/admin/list")).status === 200);
  ok("the viewer cannot change anything", (await viewer("POST", "/api/admin/action", { json: { action: "family_delete", id: view.id } })).status === 403 && (await viewer("POST", "/api/admin/rebuild")).status === 403 && (await viewer("POST", "/api/admin/action", { json: { action: "admin_add", name: "x", role: "owner" } })).status === 403);
  ok("nobody removes their own account", (await adm("POST", "/api/admin/action", { json: { action: "admin_remove", name: "owner" } })).status === 400);
  ok("removing the viewer ends its session at once", (await adm("POST", "/api/admin/action", { json: { action: "admin_remove", name: "e2eviewer" } })).status === 200 && (await viewer("GET", "/api/admin/stats")).status === 401);

  ok("unlist the room", (await adm("POST", "/api/admin/action", { json: { action: "room_unlist", id: room.id } })).status === 200 && !(await fetch(`${BASE}/api/rooms/search?q=${encodeURIComponent("이투이초")}`).then((r) => r.json())).rooms.some((h) => h.id === room.id));
  const rebuilt = await adm("POST", "/api/admin/rebuild");
  ok("rebuild the class search", rebuilt.status === 200 && typeof rebuilt.data.listed === "number");
  const log = (await adm("GET", "/api/admin/list")).data.log;
  ok("every action is in the log with who did it", ["family_block", "teacher_block", "announce", "admin_add", "admin_remove", "room_unlist", "rebuild"].every((a) => log.some((l) => l.action === a && l.by === "owner")), JSON.stringify(log.slice(0, 4)));

  // clean-up through the console
  ok("delete the teacher desk and its room", (await adm("POST", "/api/admin/action", { json: { action: "teacher_delete", id: tCreate.data.teacher.id } })).status === 200 && (await tea("GET", "/api/teacher")).status === 404);
  ok("the school leaves with its last teacher", !(await fetch(`${BASE}/api/schools/search?q=${encodeURIComponent("이투이초")}`).then((r) => r.json())).schools.some((s) => s.name === "이투이초등학교"));
  for (const c of [fam, en, fresh]) {
    const id = (await c("GET", "/api/family")).data?.family?.id;
    if (id) ok(`delete family ${id}`, (await adm("POST", "/api/admin/action", { json: { action: "family_delete", id } })).status === 200);
  }
  ok("the deleted family is gone for its own browser too", (await fam("GET", "/api/family")).status === 404 && (await partner("GET", "/api/family")).status === 404);
  await adm("DELETE", "/api/admin/login");
  ok("signing out ends the session", (await adm("GET", "/api/admin/stats")).status === 401);
}
if (!ADMIN) {
  await tea("DELETE", "/api/teacher");
  for (const c of [fam, en, fresh]) await c("DELETE", "/api/family");
}

console.log(`\n${pass} passed, ${failed.length} failed`);
for (const f of failed) console.log(`  FAIL ${f}`);
for (const n of notes) console.log(`  note: ${n}`);
process.exit(failed.length ? 1 : 0);

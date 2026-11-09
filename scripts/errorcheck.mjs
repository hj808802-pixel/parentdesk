#!/usr/bin/env node
// Error-path sweep of the API: wrong inputs, missing cookies, bad tokens, oversized
// uploads, unknown ids. Makes no model calls. Creates one throwaway family through
// POST /api/family and deletes it at the end.
//
//   node scripts/errorcheck.mjs [--url http://localhost:3002]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const BASE = opt("--url", process.env.LINKCHECK_URL ?? "https://parentdesk-app.vercel.app").replace(/\/$/, "");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const results = [];
let cookie = "";
let teacherCookie = "";

async function call(method, p, { body, headers = {}, json, form, redirect = "manual", useCookie = true } = {}) {
  const h = { ...headers };
  if (useCookie) {
    const jar = [cookie, teacherCookie].filter(Boolean);
    if (jar.length) h.cookie = jar.join("; ");
  }
  let b = body;
  if (json !== undefined) {
    h["content-type"] = "application/json";
    b = typeof json === "string" ? json : JSON.stringify(json);
  }
  if (form) b = form;
  const res = await fetch(`${BASE}${p}`, { method, headers: h, body: b, redirect });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* not json */
  }
  const sc = res.headers.get("set-cookie");
  if (useCookie && sc && /pd_family=/.test(sc)) {
    const m = /pd_family=([^;]*)/.exec(sc);
    cookie = m && m[1] ? `pd_family=${m[1]}` : "";
  }
  if (useCookie && sc && /pd_teacher=/.test(sc)) {
    const m = /pd_teacher=([^;]*)/.exec(sc);
    teacherCookie = m && m[1] ? `pd_teacher=${m[1]}` : "";
  }
  return { status: res.status, data, text, headers: res.headers };
}

function expect(name, r, status, extra = () => true, note = "") {
  const statuses = Array.isArray(status) ? status : [status];
  const okStatus = statuses.includes(r.status);
  let okExtra = true;
  try {
    okExtra = Boolean(extra(r));
  } catch {
    okExtra = false;
  }
  const errJson = r.data && typeof r.data === "object" && r.data.ok === false ? typeof r.data.error === "string" : true;
  const ok = okStatus && okExtra && errJson;
  results.push({ name, status: r.status, expect: statuses.join("/"), ok, body: (r.text || "").slice(0, 100), note });
  return ok;
}

const bigText = "x".repeat(20001);
const file = (bytes, type, name) => new File([new Uint8Array(bytes)], name, { type });

// ---- no family ----
expect("family: get without cookie", await call("GET", "/api/family"), 404);
expect("family: patch without cookie", await call("PATCH", "/api/family", { json: {} }), 404);
expect("family: delete without cookie is harmless", await call("DELETE", "/api/family"), 200);
expect("join: invalid json", await call("POST", "/api/family/join", { json: "{not json" }), 400);
expect("join: malformed key", await call("POST", "/api/family/join", { json: { key: "pd_short" } }), 400);
expect("join: unknown key", await call("POST", "/api/family/join", { json: { key: `pd_${"0".repeat(12)}_${"0".repeat(24)}` } }), 404);
expect("rotate-feed: no family", await call("POST", "/api/family/rotate-feed"), 404);
expect("item patch: no family", await call("PATCH", "/api/items/abc", { json: { status: "done" } }), 404);
expect("item delete: no family", await call("DELETE", "/api/items/abc"), 404);
expect("reply: no family", await call("POST", "/api/items/abc/reply", { json: { intent: "yes" } }), 404);
expect("explain: no family", await call("POST", "/api/items/abc/explain"), 404);
expect("ask: no family", await call("POST", "/api/ask", { json: { question: "what is due?" } }), 404);
expect("source delete: no family", await call("DELETE", "/api/sources/abc"), 404);
expect("calendar: garbage token", await call("GET", "/api/calendar/nope.ics"), 404);
expect("calendar: well-formed unknown token", await call("GET", `/api/calendar/${"0".repeat(12)}_${"0".repeat(16)}.ics`), 404);
expect("inbound: off or unauthorized", await call("POST", "/api/inbound", { json: {} }), [401, 404]);
expect("cron: no secret", await call("GET", "/api/cron/scan"), [401, 404]);
expect("cron: wrong secret", await call("GET", "/api/cron/scan", { headers: { authorization: "Bearer wrong" } }), [401, 404]);
expect("google scan: no family", await call("POST", "/api/google/scan"), 404);
expect("google disconnect: no family", await call("POST", "/api/google/disconnect"), 404);
expect("google start: redirects to settings", await call("GET", "/api/google/start"), [302, 303], (r) => /settings\?gmail=(nofamily|off)/.test(r.headers.get("location") ?? ""));
expect("google callback: bad state", await call("GET", "/api/google/callback?code=x&state=bad"), [302, 303], (r) => /settings\?gmail=(error|off)/.test(r.headers.get("location") ?? ""));
expect("google callback: denied", await call("GET", "/api/google/callback?error=access_denied"), [302, 303], (r) => /settings\?gmail=(denied|off)/.test(r.headers.get("location") ?? ""));
expect("invite: no family", await call("POST", "/api/family/invite"), 404);
expect("join: malformed invite", await call("POST", "/api/family/join", { json: { invite: "abc.def" } }), 400);
expect("join: unknown invite", await call("POST", "/api/family/join", { json: { invite: `${"0".repeat(12)}.${"0".repeat(32)}` } }), 404);
expect("billing checkout: off or no family", await call("POST", "/api/billing/checkout", { json: { interval: "month" } }), 404);
expect("billing portal: off or no family", await call("POST", "/api/billing/portal"), 404);
expect("billing webhook: off or bad signature", await call("POST", "/api/billing/webhook", { body: "{}", headers: { "stripe-signature": "t=1,v1=00" } }), [400, 404]);
expect("digest preview: no family", await call("GET", "/api/digest/preview"), 404);
expect("digest send: off or no family", await call("POST", "/api/digest/send"), 404);
expect("digest unsubscribe: bad token", await call("GET", "/api/digest/unsubscribe?u=nope"), [302, 303], (r) => /settings\?digest=badlink/.test(r.headers.get("location") ?? ""));
expect("digest unsubscribe: bad token (one-click)", await call("POST", "/api/digest/unsubscribe?u=nope"), 404);
expect("cron digest: no secret", await call("GET", "/api/cron/digest"), [401, 404]);
expect("admin login: off or bad token", await call("POST", "/api/admin/login", { json: { token: "wrong" } }), [401, 404]);
expect("admin login: not json", await call("POST", "/api/admin/login", { json: "{" }), [401, 404]);
expect("admin stats: off or unauthorized", await call("GET", "/api/admin/stats"), [401, 404]);
expect("admin stats: forged cookie", await call("GET", "/api/admin/stats", { headers: { cookie: `pd_admin=${"0".repeat(64)}` }, useCookie: false }), [401, 404]);
expect("teacher: get without cookie", await call("GET", "/api/teacher"), 404);
expect("teacher: patch without cookie", await call("PATCH", "/api/teacher", { json: { name: "x" } }), 404);
expect("teacher: create needs a name", await call("POST", "/api/teacher", { json: { name: "  " } }), 400);
expect("teacher: create not json", await call("POST", "/api/teacher", { json: "{" }), 400);
expect("teacher join: malformed key", await call("POST", "/api/teacher/join", { json: { key: "pdt_short" } }), 400);
expect("teacher join: unknown key", await call("POST", "/api/teacher/join", { json: { key: `pdt_${"0".repeat(12)}_${"0".repeat(24)}` } }), 404);
expect("teacher rooms: no teacher", await call("POST", "/api/teacher/rooms", { json: { name: "Room" } }), 404);
expect("teacher room patch: no teacher", await call("PATCH", "/api/teacher/rooms/abc", { json: { name: "x" } }), 404);
expect("teacher room post: no teacher", await call("POST", "/api/teacher/rooms/abc/post", { form: new FormData() }), 404);
expect("teacher room qr: no teacher", await call("GET", "/api/teacher/rooms/abc/qr"), 404);
expect("teacher draft send: no teacher", await call("POST", "/api/teacher/rooms/abc/drafts/xyz", { json: {} }), 404);
expect("teacher post recall: no teacher", await call("DELETE", "/api/teacher/rooms/abc/posts/xyz"), 404);
expect("room join: malformed token", await call("GET", "/api/rooms/join?r=abc"), 400);
expect("room join: unknown token", await call("GET", `/api/rooms/join?r=${"0".repeat(12)}.${"0".repeat(16)}`), 404);
expect("room join: post malformed", await call("POST", "/api/rooms/join", { json: { token: "abc" } }), 400);
expect("room: patch without family", await call("PATCH", "/api/rooms/abc", { json: { childIds: [] } }), 404);
expect("room: leave without family", await call("DELETE", "/api/rooms/abc"), 404);
expect("extract: GET not allowed", await call("GET", "/api/extract"), 405);
expect("extract: not a form", await call("POST", "/api/extract", { json: {} }), 400);
expect("extract: empty form", await call("POST", "/api/extract", { form: new FormData() }), 400);
{
  const f = new FormData();
  f.set("text", "short");
  expect("extract: text too short", await call("POST", "/api/extract", { form: f }), 400);
}
{
  const f = new FormData();
  f.set("text", bigText);
  expect("extract: text too long", await call("POST", "/api/extract", { form: f }), 413);
}
{
  const f = new FormData();
  for (let i = 0; i < 6; i++) f.append("files", file(10, "image/png", `p${i}.png`));
  expect("extract: too many files", await call("POST", "/api/extract", { form: f }), 400);
}
{
  const f = new FormData();
  f.append("files", file(4 * 1024 * 1024 + 1, "image/jpeg", "big.jpg"));
  expect("extract: file too large", await call("POST", "/api/extract", { form: f }), 413);
}
{
  const f = new FormData();
  f.append("files", file(100, "text/plain", "notes.txt"));
  expect("extract: unsupported type", await call("POST", "/api/extract", { form: f }), 400);
}
expect("share: GET goes to the add page", await call("GET", "/api/share"), [302, 303], (r) => /\/add$/.test(r.headers.get("location") ?? ""));
expect("share: empty post reports an error", await call("POST", "/api/share", { form: new FormData() }), [302, 303], (r) => /shared=error/.test(r.headers.get("location") ?? ""));

// ---- pages and statics ----
expect("page: unknown locale prefix is 404", await call("GET", "/xx/items", { redirect: "follow" }), 404);
expect("page: /en redirects to bare path", await call("GET", "/en/items"), 308, (r) => (r.headers.get("location") ?? "").endsWith("/items"));
{
  const r = await call("GET", "/", { redirect: "follow", headers: { "accept-language": "en" } });
  expect("page: security headers", r, 200, (x) => x.headers.get("x-frame-options") === "DENY" && x.headers.get("x-content-type-options") === "nosniff");
}
expect("page: pricing", await call("GET", "/pricing", { redirect: "follow", headers: { "accept-language": "en" } }), 200, (r) => r.text.includes("Family"));
expect("page: join without token", await call("GET", "/join", { redirect: "follow", headers: { "accept-language": "en" } }), 200);
expect("page: teachers", await call("GET", "/teach", { redirect: "follow", headers: { "accept-language": "en" } }), 200, (r) => r.text.includes("teacher"));
expect("page: week", await call("GET", "/week", { redirect: "follow", headers: { "accept-language": "en" } }), 200);
expect("page: admin console shell", await call("GET", "/admin", { redirect: "follow" }), 200, (r) => r.text.includes("admin"));
expect("page: admin is not localised", await call("GET", "/ko/admin", { redirect: "follow" }), 404);
expect("manifest: declares the share target", await call("GET", "/manifest.webmanifest"), 200, (r) => Boolean(r.data?.share_target?.action === "/api/share"));
expect("static: robots", await call("GET", "/robots.txt"), 200);
expect("static: sitemap", await call("GET", "/sitemap.xml"), 200, (r) => r.text.includes("<urlset"));

// ---- with a family ----
const created = await call("POST", "/api/family", { json: { locale: "fr", timezone: "Europe/Paris" } });
const key = created.data?.key;
expect("family: create", created, 200, (r) => typeof r.data?.key === "string" && r.data.family?.settings?.country === "FR" && Boolean(cookie));
if (key) {
  expect("family: get with cookie", await call("GET", "/api/family"), 200, (r) => r.data?.family?.id?.length === 12 && r.data.family.features && !("keyHash" in r.data.family));
  expect("family: invalid json", await call("PATCH", "/api/family", { json: "{" }), 400);
  const bad = await call("PATCH", "/api/family", { json: { settings: { country: "ZZ", timezone: "Mars/Olympus", currency: "usd", language: "xx", weekStart: 5, familyName: "x".repeat(100) } } });
  expect("settings: invalid values are ignored", bad, 200, (r) => {
    const s = r.data.family.settings;
    return s.country === "FR" && s.timezone === "Europe/Paris" && s.currency === "EUR" && s.language === "fr" && s.weekStart === 1 && s.familyName.length === 60;
  });
  const kids = await call("PATCH", "/api/family", {
    json: { children: [...Array.from({ length: 9 }, (_, i) => ({ name: `Kid${i}` })), { name: "   " }, { name: "y".repeat(100), color: "red" }] },
  });
  expect("children: capped at 8, names trimmed, bad colour replaced", kids, 200, (r) => {
    const c = r.data.family.children;
    return c.length === 8 && c.every((k) => k.name.length <= 40 && /^#[0-9a-f]{6}$/i.test(k.color));
  });
  expect("item patch: unknown id", await call("PATCH", "/api/items/zzz", { json: { status: "done" } }), 404);
  expect("item delete: unknown id", await call("DELETE", "/api/items/zzz"), 404);
  expect("reply: unknown item", await call("POST", "/api/items/zzz/reply", { json: { intent: "yes" } }), 404);
  expect("explain: unknown item", await call("POST", "/api/items/zzz/explain"), 404);
  expect("source delete: unknown id", await call("DELETE", "/api/sources/zzz"), 404);
  expect("ask: empty question", await call("POST", "/api/ask", { json: { question: "" } }), 400);
  expect("ask: not json", await call("POST", "/api/ask", { json: "nope" }), 400);
  expect("google scan: not connected or off", await call("POST", "/api/google/scan"), [400, 404]);
  expect("billing portal: no subscription or off", await call("POST", "/api/billing/portal"), [400, 404]);
  expect("digest preview: works for a family", await call("GET", "/api/digest/preview"), 200, (r) => typeof r.data?.subject === "string" && typeof r.data?.text === "string");
  expect("digest send: off, no address or plan", await call("POST", "/api/digest/send"), [400, 402, 404]);
  const addr = await call("PATCH", "/api/family", { json: { settings: { digestEmail: "not-an-address", digest: true, locale: "xx" } } });
  expect("settings: bad e-mail and locale ignored, digest stays off", addr, 200, (r) => r.data.family.settings.digestEmail === "" && r.data.family.settings.digest === false && r.data.family.settings.locale === "fr");
  const inv = await call("POST", "/api/family/invite");
  expect("invite: created (or Family-only once billing is on)", inv, [200, 402], (r) => r.status === 402 || /\/join\?i=[0-9a-f]{12}\.[0-9a-f]{32}$/.test(r.data.url));
  if (inv.status === 200) {
    const mine = cookie;
    cookie = "";
    const token = /i=([^&]+)/.exec(inv.data.url)[1];
    const joined = await call("POST", "/api/family/join", { json: { invite: token } });
    expect("join: invite link gives a member key and the family", joined, 200, (r) => /^pd_[0-9a-f]{12}_[0-9a-f]{24}$/.test(r.data.key) && r.data.family.id === key.slice(3, 15) && Boolean(cookie));
    expect("family: member key opens the family", await call("GET", "/api/family"), 200, (r) => r.data.family.id === key.slice(3, 15));
    cookie = "";
    await call("POST", "/api/family/join", { json: { invite: token } });
    await call("POST", "/api/family/join", { json: { invite: token } });
    cookie = "";
    expect("join: invite dead after three uses", await call("POST", "/api/family/join", { json: { invite: token } }), 404);
    cookie = mine;
  }
  // ---- class rooms: a teacher, a room, this family following it ----
  const tCreated = await call("POST", "/api/teacher", { json: { name: "Ms. Test", locale: "fr", timezone: "Europe/Paris" } });
  const tKey = tCreated.data?.key;
  expect("teacher: create", tCreated, 200, (r) => /^pdt_[0-9a-f]{12}_[0-9a-f]{24}$/.test(r.data?.key ?? "") && r.data.teacher?.name === "Ms. Test" && !("keyHash" in r.data.teacher) && Boolean(teacherCookie));
  if (tKey) {
    expect("teacher: get with cookie", await call("GET", "/api/teacher"), 200, (r) => r.data.teacher.rooms.length === 0 && r.data.teacher.postCap > 0);
    expect("teacher: patch invalid json", await call("PATCH", "/api/teacher", { json: "{" }), 400);
    expect("teacher: empty name rejected", await call("PATCH", "/api/teacher", { json: { name: " " } }), 400);
    expect("teacher: long school name capped", await call("PATCH", "/api/teacher", { json: { school: "s".repeat(100) } }), 200, (r) => r.data.teacher.school.length === 80);
    expect("teacher: school and time zone saved", await call("PATCH", "/api/teacher", { json: { school: "  Oak   Street Elementary ", settings: { timezone: "Asia/Seoul" } } }), 200, (r) => r.data.teacher.school === "Oak Street Elementary" && r.data.teacher.settings.timezone === "Asia/Seoul");
    expect("teacher rooms: empty name", await call("POST", "/api/teacher/rooms", { json: { name: "" } }), 400);
    const roomRes = await call("POST", "/api/teacher/rooms", { json: { name: "  Room   12 " } });
    expect("teacher rooms: create", roomRes, 200, (r) => r.data.teacher.rooms.length === 1 && r.data.teacher.rooms[0].name === "Room 12" && /^[0-9a-f]{12}\.[0-9a-f]{16}$/.test(r.data.teacher.rooms[0].joinToken) && !("joinSecret" in r.data.teacher.rooms[0]));
    const room = roomRes.data?.teacher?.rooms?.[0];
    if (room) {
      expect("teacher room post: unknown room", await call("POST", `/api/teacher/rooms/${"0".repeat(12)}/post`, { form: new FormData() }), 404);
      expect("teacher room post: not a form", await call("POST", `/api/teacher/rooms/${room.id}/post`, { json: {} }), 400);
      expect("teacher room post: empty", await call("POST", `/api/teacher/rooms/${room.id}/post`, { form: new FormData() }), 400);
      {
        const f = new FormData();
        f.set("text", "short");
        expect("teacher room post: text too short", await call("POST", `/api/teacher/rooms/${room.id}/post`, { form: f }), 400);
      }
      {
        const f = new FormData();
        f.set("text", bigText);
        expect("teacher room post: text too long", await call("POST", `/api/teacher/rooms/${room.id}/post`, { form: f }), 413);
      }
      {
        const f = new FormData();
        f.append("files", file(100, "text/plain", "n.txt"));
        expect("teacher room post: unsupported type", await call("POST", `/api/teacher/rooms/${room.id}/post`, { form: f }), 400);
      }
      expect("teacher room qr: unknown room", await call("GET", `/api/teacher/rooms/${"0".repeat(12)}/qr`), 404);
      expect("teacher room qr: svg of the link", await call("GET", `/api/teacher/rooms/${room.id}/qr?l=ko`), 200, (r) => r.text.startsWith("<svg") && (r.headers.get("content-type") ?? "").includes("image/svg+xml") && /private, no-store/.test(r.headers.get("cache-control") ?? ""));
      expect("teacher draft send: unknown draft", await call("POST", `/api/teacher/rooms/${room.id}/drafts/${"0".repeat(10)}`, { json: { drop: [], targets: [] } }), 404);
      expect("teacher draft discard: unknown draft", await call("DELETE", `/api/teacher/rooms/${room.id}/drafts/${"0".repeat(10)}`), 404);
      expect("teacher post recall: unknown post", await call("DELETE", `/api/teacher/rooms/${room.id}/posts/${"0".repeat(10)}`), 404);
      expect("teacher room: note saved and capped", await call("PATCH", `/api/teacher/rooms/${room.id}`, { json: { description: "  Office   hours " + "x".repeat(400) } }), 200, (r) => r.data.teacher.rooms[0].description.startsWith("Office hours x") && r.data.teacher.rooms[0].description.length === 300);
      expect("room join: info", await call("GET", `/api/rooms/join?r=${room.joinToken}`), 200, (r) => r.data.room?.name === "Room 12" && r.data.room.teacherName === "Ms. Test" && r.data.room.school === "Oak Street Elementary" && r.data.room.description.startsWith("Office hours") && r.data.following === false);
      expect("room join: wrong secret", await call("GET", `/api/rooms/join?r=${room.id}.${"f".repeat(16)}`), 404);
      const joined = await call("POST", "/api/rooms/join", { json: { token: room.joinToken, childIds: ["nope"] } });
      expect("room join: family follows the room", joined, 200, (r) => r.data.family?.rooms?.length === 1 && r.data.family.rooms[0].roomId === room.id && r.data.family.rooms[0].school === "Oak Street Elementary" && r.data.family.rooms[0].childIds.length === 0 && r.data.key === undefined);
      expect("room join: info shows following", await call("GET", `/api/rooms/join?r=${room.joinToken}`), 200, (r) => r.data.following === true);
      expect("teacher: room counts the member", await call("GET", "/api/teacher"), 200, (r) => r.data.teacher.rooms[0].memberCount === 1);
      expect("room: children of unknown room", await call("PATCH", `/api/rooms/${"0".repeat(12)}`, { json: { childIds: [] } }), 404);
      expect("room: children patch", await call("PATCH", `/api/rooms/${room.id}`, { json: { childIds: [] } }), 200);
      const rotated = await call("PATCH", `/api/teacher/rooms/${room.id}`, { json: { rotate: true } });
      expect("teacher room: rotate changes the token", rotated, 200, (r) => r.data.teacher.rooms[0].joinToken !== room.joinToken);
      expect("room join: old token dead after rotate", await call("GET", `/api/rooms/join?r=${room.joinToken}`), 404);
      expect("room: leave", await call("DELETE", `/api/rooms/${room.id}`), 200, (r) => r.data.family.rooms.length === 0);
      expect("room: leave twice", await call("DELETE", `/api/rooms/${room.id}`), 404);
      expect("teacher room: delete", await call("DELETE", `/api/teacher/rooms/${room.id}`), 200, (r) => r.data.teacher.rooms.length === 0);
      expect("teacher room: delete unknown", await call("DELETE", `/api/teacher/rooms/${room.id}`), 404);
    }
    const savedTeacher = teacherCookie;
    expect("teacher leave: clears the cookie", await call("POST", "/api/teacher/leave"), 200, (r) => /pd_teacher=;/.test(r.headers.get("set-cookie") ?? ""));
    teacherCookie = "";
    expect("teacher: gone after leave", await call("GET", "/api/teacher"), 404);
    expect("teacher join: own key restores the desk", await call("POST", "/api/teacher/join", { json: { key: tKey } }), 200, (r) => r.data.teacher.name === "Ms. Test" && Boolean(teacherCookie));
    if (!teacherCookie) teacherCookie = savedTeacher;
    expect("teacher: delete", await call("DELETE", "/api/teacher"), 200);
    teacherCookie = savedTeacher;
    expect("teacher: gone after delete", await call("GET", "/api/teacher"), 404);
    teacherCookie = "";
  }

  const fam = (await call("GET", "/api/family")).data.family;
  const feed = await call("GET", `/api/calendar/${fam.feedToken}.ics`, { useCookie: false });
  expect("calendar: feed works without cookie", feed, 200, (r) => r.text.includes("BEGIN:VCALENDAR") && (r.headers.get("content-type") ?? "").includes("text/calendar"));
  expect("calendar: wrong secret", await call("GET", `/api/calendar/${fam.id}_${"f".repeat(16)}.ics`, { useCookie: false }), 404);
  const rotated = await call("POST", "/api/family/rotate-feed");
  expect("rotate-feed: token changes", rotated, 200, (r) => r.data.family.feedToken !== fam.feedToken);
  expect("calendar: old token dead after rotate", await call("GET", `/api/calendar/${fam.feedToken}.ics`, { useCookie: false }), 404);
  const saved = cookie;
  expect("leave: clears the cookie", await call("POST", "/api/family/leave"), 200, (r) => /Max-Age=0/.test(r.headers.get("set-cookie") ?? ""));
  cookie = "";
  expect("family: gone after leave", await call("GET", "/api/family"), 404);
  const joined = await call("POST", "/api/family/join", { json: { key } });
  expect("join: own key restores the family", joined, 200, (r) => r.data.family.id === fam.id && Boolean(cookie));
  if (!cookie) cookie = saved;
  expect("family: delete", await call("DELETE", "/api/family"), 200);
  cookie = saved;
  expect("family: gone after delete", await call("GET", "/api/family"), 404);
  expect("calendar: gone after delete", await call("GET", `/api/calendar/${rotated.data.family.feedToken}.ics`, { useCookie: false }), 404);
}

const bad = results.filter((r) => !r.ok);
console.log(`errorcheck ${BASE}`);
console.log(`checks ${results.length} (bad ${bad.length})`);
for (const r of bad) console.log(`FAIL ${r.status} (expected ${r.expect}) ${r.name} ${JSON.stringify(r.body)}`);
const outDir = path.join(root, "data", "errorcheck");
fs.mkdirSync(outDir, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, "-");
fs.writeFileSync(path.join(outDir, `${ts}.json`), JSON.stringify({ base: BASE, ts, results }, null, 2));
if (bad.length) process.exit(1);

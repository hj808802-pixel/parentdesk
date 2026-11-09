#!/usr/bin/env node
// Page, link and API sweep of a deployed (or local) build.
//
//   node scripts/linkcheck.mjs [--url https://parentdesk-app.vercel.app]
//
// 1. Fetches every page in every UI locale and the static files, and follows every
//    internal link found in them (expects 200; the 404 page is expected to be 404).
// 2. Calls the API routes without secrets and checks the status codes.
// Makes no model calls and creates no family.

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
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

const PREFIXES = ["", "/ko", "/es", "/ja", "/zh", "/fr", "/de", "/pt", "/it", "/vi"];
const PAGES = ["/", "/week", "/add", "/items", "/sources", "/settings", "/pricing", "/join", "/teach", "/privacy", "/terms"];
const STATIC = ["/manifest.webmanifest", "/robots.txt", "/sitemap.xml", "/favicon.ico", "/og.png", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png", "/sample-notice.png"];

async function get(url, opts = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), opts.timeout ?? 20000);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: opts.method ?? "GET",
      headers: { "user-agent": UA, "accept-language": "en", accept: "text/html,*/*", ...(opts.headers ?? {}) },
      body: opts.body,
      redirect: "follow",
      signal: ctl.signal,
    });
    const text = opts.noBody ? "" : await res.text();
    return { status: res.status, url: res.url, text, ms: Date.now() - started };
  } catch (e) {
    return { status: 0, url, text: "", ms: Date.now() - started, error: String(e?.cause?.code ?? e?.name ?? e) };
  } finally {
    clearTimeout(t);
  }
}

const links = (html) => [...new Set([...html.matchAll(/\b(?:href|src)=["']([^"']+)["']/g)].map((m) => m[1]))];
const add = (map, key, ref) => map.set(key, [...(map.get(key) ?? []), ref]);

const pages = [];
const internal = new Map();
for (const p of PREFIXES) {
  for (const pg of PAGES) {
    const url = `${BASE}${p}${pg === "/" ? (p ? "" : "/") : pg}`;
    const r = await get(url);
    pages.push({
      url,
      status: r.status,
      ms: r.ms,
      lang: (r.text.match(/<html[^>]*\blang=["']([^"']+)["']/) ?? [])[1] ?? "",
      title: (r.text.match(/<title>([^<]*)<\/title>/) ?? [])[1] ?? "",
      error: r.error ?? (/Application error|__next_error__/.test(r.text) ? "error page" : undefined),
    });
    for (const h of links(r.text)) {
      if (/^(mailto:|tel:|data:|#|javascript:)/.test(h)) continue;
      if (/^https?:\/\//.test(h)) {
        if (h.startsWith(BASE)) add(internal, h, url);
      } else if (h.startsWith("/") && !h.startsWith("/_next/")) add(internal, `${BASE}${h.split("?")[0]}`, url);
    }
  }
}
for (const s of ["/this-page-does-not-exist", "/ja/this-page-does-not-exist", ...STATIC]) add(internal, `${BASE}${s}`, "(static)");

const internalResults = [];
for (const [url, refs] of internal) {
  const r = await get(url);
  const expect404 = url.includes("does-not-exist");
  internalResults.push({ url, status: r.status, ms: r.ms, ok: expect404 ? r.status === 404 : r.status === 200 && !/Application error|__next_error__/.test(r.text), refs: [...new Set(refs)].slice(0, 3) });
}

const api = [];
async function check(name, url, opts, expect) {
  const r = await get(url, opts);
  api.push({ name, status: r.status, expect, ok: expect.includes(r.status), body: r.text.slice(0, 120) });
}
const json = (body) => ({ method: "POST", headers: { "content-type": "application/json" }, body });
await check("health", `${BASE}/api/health`, {}, [200]);
await check("family: none", `${BASE}/api/family`, {}, [404]);
await check("family: patch without cookie", `${BASE}/api/family`, { method: "PATCH", headers: { "content-type": "application/json" }, body: "{}" }, [404]);
await check("join: bad key", `${BASE}/api/family/join`, json(JSON.stringify({ key: "nope" })), [400]);
await check("items: no family", `${BASE}/api/items/abc`, { method: "PATCH", headers: { "content-type": "application/json" }, body: "{}" }, [404]);
await check("sources: no family", `${BASE}/api/sources/abc`, { method: "DELETE" }, [404]);
await check("calendar: bad token", `${BASE}/api/calendar/nope.ics`, {}, [404]);
await check("inbound: off or unauthorized", `${BASE}/api/inbound`, json("{}"), [401, 404]);
await check("extract: empty", `${BASE}/api/extract`, { method: "POST", body: new FormData() }, [400]);
await check("extract: GET", `${BASE}/api/extract`, {}, [405]);
const big = new FormData();
big.append("text", "x".repeat(20001));
await check("extract: too long", `${BASE}/api/extract`, { method: "POST", body: big }, [413]);
await check("ask: no family", `${BASE}/api/ask`, json(JSON.stringify({ question: "what is due?" })), [404]);
await check("reply: no family", `${BASE}/api/items/abc/reply`, json(JSON.stringify({ intent: "yes", note: "" })), [404]);
await check("explain: no family", `${BASE}/api/items/abc/explain`, { method: "POST" }, [404]);
await check("share: GET redirects to add", `${BASE}/api/share`, { noBody: true }, [200]);
await check("google start: off or no family", `${BASE}/api/google/start`, {}, [200, 404]);
await check("google scan: off or no family", `${BASE}/api/google/scan`, { method: "POST" }, [404]);
await check("cron: needs secret", `${BASE}/api/cron/scan`, {}, [401, 404]);
await check("teacher: none", `${BASE}/api/teacher`, {}, [404]);
await check("teacher join: bad key", `${BASE}/api/teacher/join`, json(JSON.stringify({ key: "nope" })), [400]);
await check("room join: bad token", `${BASE}/api/rooms/join?r=nope`, {}, [400]);
await check("room: no family", `${BASE}/api/rooms/abc`, { method: "DELETE" }, [404]);
await check("teacher room qr: no teacher", `${BASE}/api/teacher/rooms/abc/qr`, {}, [404]);
await check("teacher translate: no teacher", `${BASE}/api/teacher/translate`, json(JSON.stringify({ text: "hola" })), [404]);

const badPages = pages.filter((p) => p.status !== 200 || p.error);
const badInternal = internalResults.filter((p) => !p.ok);
const badApi = api.filter((p) => !p.ok);

console.log(`linkcheck ${BASE}`);
console.log(`pages ${pages.length} (bad ${badPages.length}) | internal links ${internalResults.length} (bad ${badInternal.length}) | api checks ${api.length} (bad ${badApi.length})`);
for (const p of badPages) console.log(`PAGE    ${p.status} ${p.url} ${p.error ?? ""}`);
for (const p of badInternal) console.log(`LINK    ${p.status} ${p.url} <- ${p.refs.join(", ")}`);
for (const p of badApi) console.log(`API     ${p.status} (expected ${p.expect.join("/")}) ${p.name} ${JSON.stringify(p.body)}`);

const outDir = path.join(root, "data", "linkcheck");
fs.mkdirSync(outDir, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, "-");
fs.writeFileSync(path.join(outDir, `${ts}.json`), JSON.stringify({ base: BASE, ts, pages, internal: internalResults, api }, null, 2));
console.log(`written ${path.relative(root, path.join(outDir, `${ts}.json`))}`);

if (badPages.length || badInternal.length || badApi.length) process.exit(1);

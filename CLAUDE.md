# ParentDesk (부모 행정 비서)

School notices (photo, PDF, pasted text, shared message, Gmail) → events, deadlines, payments, consent forms and to-dos per child, with a calendar feed. Live: https://parentdesk-app.vercel.app (Vercel project `parentdesk-app`, auto-deploys from `main`). Public repo: do not commit anything private.

## Working with the user
- The user writes Korean and reads replies on a phone (Remote Control). Answer in Korean, be direct, work autonomously, and **end every message with a "결과 보기" line of tappable links** (production URL first, never localhost; the commit when code changed; file paths as links for documents).
- Planning docs are NOT in this repo (it is public). They live in `C:\Users\junyo\OneDrive\바탕 화면\에이전트\docs\`: `아이디어_부모행정비서_ParentDesk_구조계획.md` (plan, §1–20 incl. version logs), `ParentDesk_Gmail연결_설정가이드.md`, `ParentDesk_결제·요약메일_설정가이드.md`. Append a new section to the plan doc after each release.
- Commits end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Commit and push only when the work is verified (tests, lint, tsc, build, error sweep).

## Secrets (never print, never commit)
- `ANTHROPIC_API_KEY` is a Windows **user** env var. Start the dev server with it from PowerShell: `$env:ANTHROPIC_API_KEY = [Environment]::GetEnvironmentVariable('ANTHROPIC_API_KEY','User'); npm run dev -- -p 3002`. Never echo it, never write it to a file, never pass it on a command line.
- `.env.local`, `.google-oauth.local`, `.admin.local` hold the local copies of Vercel env values; `*.local`, `.env*` (except `.env.example`) and `data/` are gitignored. Vercel is the source of truth (`npx vercel env ls`, `printf '%s' value | npx vercel env add NAME production --yes`).
- Google OAuth client lives in Google Cloud project `parentdesk-513816` (Testing mode: 7-day refresh tokens, unverified-app warning).
- Never run `npm run eval` or extraction scripts against production; use the local server.

## Stack and layout
Next.js 16 App Router + Turbopack, React 19, Tailwind 4, TypeScript, zod 4, `@anthropic-ai/sdk` (structured output via `betaZodOutputFormat`), `@vercel/blob` (one private JSON per family under `parentdesk/families/`, ops docs under `parentdesk/ops/`), vitest.
- `src/app/[locale]/…` pages (10 UI locales: en bare path, ko es ja zh fr de pt it vi prefixed; routing in `src/proxy.ts`; `/teach` is the teacher desk, `/join` handles both `?i=` partner invites and `?r=` room links), `src/app/admin` (English-only operator console, outside locale routing), `src/app/api/…` route handlers (`api/teacher/*` teacher side, `api/rooms/*` parent side of class rooms).
- `src/lib/`: `extract.ts` (model prompt + country packs from `knowledge/countries/*.md`), `schema.ts` (zod shapes, 21 result languages), `store.ts` + `types.ts` (family document, keys, invites, views), `rooms.ts` (teachers, class rooms, posts, fan-out delivery; documents `teachers/<id>` and `rooms/<id>`), `plan.ts` (Free/Family gating; everything is Family while Stripe keys are unset), `stripe.ts`, `digest.ts`, `gmail.ts`, `assist.ts` (ask, reply, inbox classifier, post translation), `dedupe.ts`, `admin.ts`, `ops.ts`, `i18n/*.ts` (dictionaries; `en.ts` is the source of truth and the parity test fails when a key is missing anywhere).
- Design rules to keep: no accounts (family key `pd_<id>_<secret>` and teacher key `pdt_<id>_<secret>` in HttpOnly cookies, hashes on the server, member keys from invite links), minimal child data (first name + colour only), uploads never stored, results shown with `dir="auto"`. Teachers never see family ids or names, only counts; a room post costs one extraction plus one translation per result language.
- Models: extraction `EXTRACT_MODEL` (claude-opus-5-5), assistant `ASSIST_MODEL` (claude-sonnet-5-5), inbox classifier `CLASSIFY_MODEL` (claude-haiku-5-5). Every model path has a mock when no key is set.

## Commands
```
npm run dev -- -p 3002        # local, with the API key in the environment (see Secrets)
npm test                      # vitest (67 tests; i18n parity, store, rooms, plan, stripe, digest, admin, gmail, dedupe, dates, ics)
npm run lint && npm run typecheck && npm run build
node scripts/errorcheck.mjs --url http://localhost:3002   # 132 API error-path checks, no model calls (restart the dev server first if a previous run hit the 60/hour IP limiter)
node scripts/linkcheck.mjs  --url http://localhost:3002   # every page in every locale, internal links, API status codes
```
Run both scripts against production too after a deploy (default URL is production). Local families are JSON files under `data/families/`; edit them to simulate states (usage caps, billing) instead of spending model calls.

## Conventions
- New UI text goes into all 10 dictionaries in one patch (write a Node script with the Write tool; Korean on the command line garbles and commands over ~8 KB truncate on this machine).
- New optional features are env-gated and reported by `/api/health`; the UI hides what the server has not configured.
- API errors are `{ ok: false, error: "<code>" }` with codes mapped in `add.errors` of the dictionaries; 402 `plan_limit` is the plan gate, 429 the rate limiter.
- Keep `scripts/errorcheck.mjs` and `scripts/linkcheck.mjs` in step with new routes and pages, and add a vitest file per new lib module.
- Verify in the browser pane (viewport 375 px for phone checks) before declaring UI work done.

## Status (2026-11-09)
v0.5 deployed: class rooms for teachers (`/teach`, `lib/rooms.ts`, plan doc §21). v0.4 before it. User-side work remaining: Stripe account and price ids, a domain + Resend for the weekly summary and e-mail forwarding, Google app verification before leaving Testing mode, real 가정통신문 checks on the phone. Later ideas: translate room posts for languages that join later, QR code for room links, KV-based rate limiting, RTL UI locales.

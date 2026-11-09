# ParentDesk

Every school notice, turned into your family calendar and to-do list.

Snap a photo of the newsletter, paste the class message or forward the e-mail. In about 30 seconds you get the events, deadlines, payments, forms to sign and things to bring, sorted by child, with a calendar feed your phone subscribes to. No account. Works in any country and language.

Live: https://parentdesk-app.vercel.app

## How it works

1. **Capture**: photo, PDF, screenshot, pasted text (a whole chat export works: the model keeps only the school messages and reports how many it used), the Android share sheet, e-mail forwarding to a per-family address, or a connected Gmail inbox checked once a day.
2. **Extract**: Claude reads the notice with the family's country pack (date order, currency, school-year habits, local vocabulary) and returns structured items (`src/lib/schema.ts`).
3. **Act**: the home screen (today at a glance, what is next, latest notices, class rooms), the week view, "needs your action", per-child filters, one-tap done/dismiss, Google Calendar links, `.ics` downloads and a read-only **calendar feed** (`/api/calendar/<token>.ics`) with reminders that Google, Apple and Outlook calendars refresh on their own. Items the family already has are skipped (`src/lib/dedupe.ts`).
4. **Ask, explain and reply**: ask the assistant about the list (`/api/ask`, answers only from saved items), have one item explained in plain words with the steps and the local background a newcomer would not know (`/api/items/[id]/explain`), and draft a reply to the school in the notice's language with a translation (`/api/items/[id]/reply`), also straight from a notice's open questions. Nothing is sent from ParentDesk. The home screen adds a week brief, a packing checklist for today and tomorrow, and the week view warns when two children have overlapping times, all without a model call.

## Principles

- **Global first.** Country is a setting. `src/lib/countries.ts` holds the defaults, `knowledge/countries/*.md` the notes the model gets. The UI never branches on country.
- **No accounts.** A family key (`pd_<id>_<secret>`) lives in an HttpOnly cookie; paste it on a partner's phone to share. The server stores only a hash.
- **Minimal children's data.** First name or nickname and a colour. No birth dates, school names or photos. Uploads are processed and discarded; only the extracted items and a short summary are kept. One button deletes the whole family.
- **The paper wins.** Every item carries the line of the notice it came from and a confidence flag.

## Stack

Next.js 16 (App Router) · React 19 · Tailwind 4 · TypeScript · zod · Anthropic SDK (structured outputs, prompt caching) · Vercel (functions, Blob) · vitest.

```
knowledge/countries/        country packs (markdown, read at request time)
src/app/[locale]/           pages: / (landing, or the home screen once a family exists), /week, /add, /items, /sources, /settings, /teach (teachers), /join, /pricing, /privacy, /terms
src/app/api/                extract, share, ask, family (+join, leave, rotate-feed, invite), items/[id] (+reply, explain), sources/[id], calendar/[feed], inbound, google/{start,callback,scan,disconnect}, teacher (+join, leave, rooms, rooms/[id], rooms/[id]/{post,qr}, rooms/[id]/drafts/[draftId], rooms/[id]/posts/[postId]), rooms/{join,[id]}, billing/*, digest/*, cron/{scan,digest}, admin/*, health
src/components/             HomeView, AddNotice, ItemCard, ItemsView, SourcesView, SettingsView, TeachView, JoinView, Landing, …
src/lib/                    extract (Claude), assist (ask, reply, explain, inbox classifier, post translation), rooms (teachers and class rooms), dashboard (home numbers, brief, packing list, clashes), gmail, dedupe, crypto, store (family document), plan, stripe, digest, admin, schema, countries, dates, ics, ratelimit, i18n/*
integrations/               Cloudflare Email Worker for e-mail forwarding
scripts/linkcheck.mjs       page/link/API sweep of a deployment
tests/                      vitest
```

UI languages: English (bare path), 한국어, Español, 日本語, 中文, Français, Deutsch, Português, Italiano, Tiếng Việt (`/ja/...`). Result languages: 21 (`OUTPUT_LANGUAGES`). Country packs: 24 countries plus a generic note (`knowledge/countries/`), 40 countries with defaults in `src/lib/countries.ts`; country names in the settings come from `Intl.DisplayNames`, result text renders with `dir="auto"` so Arabic, Hebrew, Persian and Urdu results read correctly.

## Run locally

```bash
npm ci
cp .env.example .env.local   # fill ANTHROPIC_API_KEY, or leave empty for demo mode
npm run dev
```

Without an API key the app runs in demo mode (a canned extraction of the sample newsletter). `LOCAL_DATA_DIR=./data` keeps families as JSON files under `data/families/` (gitignored).

Checks:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run linkcheck -- --url http://localhost:3000
node scripts/errorcheck.mjs --url http://localhost:3000   # error paths, no model calls
```

## Auto-collect channels

- **Share sheet (Android)**: the manifest declares a `share_target`; after "Add to Home screen", any app's Share menu posts to `/api/share`, which extracts and lands on `/add?shared=<source>`. iOS web apps have no share target; paste instead.
- **E-mail forwarding**: `INBOUND_DOMAIN` + `INBOUND_SECRET` and the Cloudflare worker in `integrations/` (needs a domain).
- **Gmail (beta)**: `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (OAuth web client, redirect `<origin>/api/google/callback`, scope `gmail.readonly`) and `TOKEN_ENCRYPTION_KEY` (64 hex chars; refresh tokens are sealed with AES-256-GCM). The daily cron in `vercel.json` calls `/api/cron/scan` with `CRON_SECRET`. Trusted senders pass straight through; the rest are sorted by the classifier model (`CLASSIFY_MODEL`, default claude-haiku-5-5) before the extractor runs. Settings shows the channel only when the server has it configured.

## Plans, weekly summary, invites, admin console (v0.4)

- **Plans** (`src/lib/plan.ts`): while no Stripe keys are set every family has the Family plan and the beta is free. With `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and a price id, a family without a subscription is on Free: `FREE_MONTHLY_NOTICES` (15) notices a month and `FREE_MAX_CHILDREN` (1); Gmail, e-mail forwarding, the weekly summary and invite links are Family-only. Over the cap the API answers 402 `plan_limit`. The family key keeps working for everyone.
- **Stripe** (`src/lib/stripe.ts`, REST, no SDK): `POST /api/billing/checkout` opens Checkout (monthly or yearly, `client_reference_id` = family id, the id also in subscription metadata), `POST /api/billing/portal` opens the Customer Portal, `POST /api/billing/webhook` verifies `Stripe-Signature` (HMAC, 5-minute tolerance, replays and out-of-order events ignored) and mirrors the subscription status into the family document. Nothing about the card is stored. `/pricing` shows the plans in every UI language.
- **Weekly summary** (`src/lib/digest.ts`): past due, this week, next week, to pay (sums per currency), to sign and dateless to-dos, written in the family's UI language without a model call. Sent through Resend (`RESEND_API_KEY`, `DIGEST_FROM`) by `/api/cron/digest` on Sunday 21:00 UTC with one-click unsubscribe headers and a signed unsubscribe link; Settings has the address, the switch, a test send and a preview (the preview works without Resend).
- **Invite links** (`POST /api/family/invite`, `/join?i=<family>.<secret>`): the record keeps a hash; a link works 3 times for 3 days, at most 5 live. A device that joins gets a member key of its own (same format; up to 10 hashes per family).
- **Admin console** (`/admin`, `ADMIN_TOKEN` of 16+ characters): the token is exchanged for an HttpOnly cookie holding its hash; `/api/admin/stats` walks the family documents and returns counts only (families, items, notices per day, plans, Gmail, digest, countries, languages, lifetime counters, last cron runs from `ops/runs.json`) plus a per-family summary without item text or child names. Lives outside the locale routing and is never indexed.

## Class rooms for teachers (v0.5)

A teacher opens a desk at `/teach` (no account: a teacher key `pdt_<id>_<secret>` in an HttpOnly cookie, hash on the server; a display name, and optionally a school name and a time zone), opens a room per class and shares its link (`/join?r=<room id>.<secret>`). Parents who open the link pick the children in that class and follow the room; a browser without a family gets one created on the spot. When the teacher reads a notice in (text, photo or PDF), it is extracted **once** in the teacher's language and kept as a draft; the teacher unticks anything the families should not get and sends it to the room (or to several rooms at once, one delivery per family). A sent post can be recalled from the rooms and from every family that received it. On sending it is translated **once per result language** the following families use (`translatePost`, Sonnet, free-text fields only), and written onto every family's list with the right children attached. Late joiners get the room's posts of the last 30 days, translated into their language on the way in when no earlier member read it (`postsNeedingTranslation`, at most 5 posts per join); the room keeps every translation for the next family. Each room has a QR code of its link (`/api/teacher/rooms/[id]/qr`, drawn on the server with `qrcode`, teacher-only). Teachers see only how many families follow; families see the sender as "school · room · teacher". Joining stays link- or QR-only on purpose: there is no public directory of schools or classes. Documents: `teachers/<id>`, `rooms/<id>`; the family document keeps a `rooms[]` subscription list. Caps: `TEACHER_MONTHLY_POSTS` (default 100) posts per teacher per month, 10 rooms per teacher, 300 families per room.

## Deploy (Vercel)

1. Import the repository, framework Next.js.
2. Environment variables: `ANTHROPIC_API_KEY`, `BLOB_READ_WRITE_TOKEN` (attach a Blob store; families live under `parentdesk/families/`), `NEXT_PUBLIC_SITE_URL`. Optional: `EXTRACT_MODEL`, `DAILY_CAP`, `HOURLY_CAP_PER_FAMILY`, `HOURLY_CAP_PER_IP`.
3. E-mail forwarding (optional): a domain on Cloudflare, the worker in `integrations/`, and `INBOUND_DOMAIN` + `INBOUND_SECRET` on Vercel. Settings then shows each family's forwarding address.

## Data model

```
Family { id, keyHash, feedSecret, inboundCode, settings{country, language, timezone, dateOrder, currency, weekStart, familyName}, children[], sources[], items[], usage{} }
Child  { id, name, color }
Source { id, ts, kind: upload|paste|email|sample|share|gmail|room, title, sender, summary, language, pages, questions[], roomId?, postId? }
Family.rooms[] { roomId, name, teacherName, childIds[], joinedAt, lastPostId }
Teacher { id, keyHash, name, school, settings, roomIds[], usage{} }  # teachers/<id>
Room    { id, teacherId, name, description, joinSecret, members[{familyId}], drafts[RoomPost], posts[{ id, ts, title, summary, language, items[ItemDraft], translations{lang}, delivered }] }   # rooms/<id>
Item   { id, sourceId, type: event|deadline|todo|payment|consent|info, title, description, date, end_date, time, end_time, all_day,
         location, amount, currency, bring[], requires_action, action_text, confidence, quote, childIds[], status: open|done|dismissed }
```

## Cost

One extraction is roughly 3–6K input tokens (notice + cached rules and country notes) and 1–2K output tokens: well under a cent with caching at current Opus prices. Caps in `.env.example` protect the bill during the beta.

## Status

v0.5 beta (2026-11-09): extraction, assistant, auto-collect channels, 10 UI languages, plans and Stripe billing, weekly summary e-mail, partner invite links, admin console, and class rooms for teachers (one post, every following family's list in its own language). Billing and e-mail sending switch on when their keys are set. v0.5.1 (same day): late joiners get the posts translated into their own language, and each room has a QR code. v0.6 (same day): a home screen for families at `/` (today at a glance, what is next, latest notices, class rooms, the assistant); the week list moved to `/week`. See the plan in the author's notes.

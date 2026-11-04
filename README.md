# ParentDesk

Every school notice, turned into your family calendar and to-do list.

Snap a photo of the newsletter, paste the class message or forward the e-mail. In about 30 seconds you get the events, deadlines, payments, forms to sign and things to bring, sorted by child, with a calendar feed your phone subscribes to. No account. Works in any country and language.

Live: https://parentdesk.vercel.app

## How it works

1. **Capture**: photo, PDF, screenshot, pasted text, or (optional) e-mail forwarding to a per-family address.
2. **Extract**: Claude reads the notice with the family's country pack (date order, currency, school-year habits, local vocabulary) and returns structured items (`src/lib/schema.ts`).
3. **Act**: the week view, "needs your action", per-child filters, one-tap done/dismiss, Google Calendar links, `.ics` downloads and a read-only **calendar feed** (`/api/calendar/<token>.ics`) with reminders that Google, Apple and Outlook calendars refresh on their own.

## Principles

- **Global first.** Country is a setting. `src/lib/countries.ts` holds the defaults, `knowledge/countries/*.md` the notes the model gets. The UI never branches on country.
- **No accounts.** A family key (`pd_<id>_<secret>`) lives in an HttpOnly cookie; paste it on a partner's phone to share. The server stores only a hash.
- **Minimal children's data.** First name or nickname and a colour. No birth dates, school names or photos. Uploads are processed and discarded; only the extracted items and a short summary are kept. One button deletes the whole family.
- **The paper wins.** Every item carries the line of the notice it came from and a confidence flag.

## Stack

Next.js 16 (App Router) · React 19 · Tailwind 4 · TypeScript · zod · Anthropic SDK (structured outputs, prompt caching) · Vercel (functions, Blob) · vitest.

```
knowledge/countries/        country packs (markdown, read at request time)
src/app/[locale]/           pages: / (week), /add, /items, /sources, /settings, /privacy, /terms
src/app/api/                extract, family (+join, leave, rotate-feed), items/[id], sources/[id], calendar/[feed], inbound, health
src/components/             HomeView, AddNotice, ItemCard, ItemsView, SourcesView, SettingsView, Landing, …
src/lib/                    extract (Claude), store (family document), schema, countries, dates, ics, ratelimit, i18n/*
integrations/               Cloudflare Email Worker for e-mail forwarding
scripts/linkcheck.mjs       page/link/API sweep of a deployment
tests/                      vitest
```

UI languages: English (bare path), 한국어, Español, 日本語, 中文, Français, Deutsch (`/ja/...`). Result languages: 21 (`OUTPUT_LANGUAGES`).

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
```

## Deploy (Vercel)

1. Import the repository, framework Next.js.
2. Environment variables: `ANTHROPIC_API_KEY`, `BLOB_READ_WRITE_TOKEN` (attach a Blob store; families live under `parentdesk/families/`), `NEXT_PUBLIC_SITE_URL`. Optional: `EXTRACT_MODEL`, `DAILY_CAP`, `HOURLY_CAP_PER_FAMILY`, `HOURLY_CAP_PER_IP`.
3. E-mail forwarding (optional): a domain on Cloudflare, the worker in `integrations/`, and `INBOUND_DOMAIN` + `INBOUND_SECRET` on Vercel. Settings then shows each family's forwarding address.

## Data model

```
Family { id, keyHash, feedSecret, inboundCode, settings{country, language, timezone, dateOrder, currency, weekStart, familyName}, children[], sources[], items[], usage{} }
Child  { id, name, color }
Source { id, ts, kind: upload|paste|email|sample, title, sender, summary, language, pages, questions[] }
Item   { id, sourceId, type: event|deadline|todo|payment|consent|info, title, description, date, end_date, time, end_time, all_day,
         location, amount, currency, bring[], requires_action, action_text, confidence, quote, childIds[], status: open|done|dismissed }
```

## Cost

One extraction is roughly 3–6K input tokens (notice + cached rules and country notes) and 1–2K output tokens: well under a cent with caching at current Opus prices. Caps in `.env.example` protect the bill during the beta.

## Status

v0.1 beta (2026-11-05). Not yet: payments, weekly digest e-mail, partner invite links, school-side dashboard. See the plan in the author's notes.

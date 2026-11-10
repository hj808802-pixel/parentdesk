import fs from "node:fs";
import { noteUsage } from "./usage";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { countryOf, type DateOrder } from "./countries";
import { addDays, nextWeekday, todayIn, weekday } from "./dates";
import { sampleDates } from "./sample";
import { ExtractionSchema, OUTPUT_LANGUAGES, type Extraction } from "./schema";
import type { FamilyRecord } from "./types";

export type ImageMediaType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

export type InputFile =
  | { kind: "image"; mediaType: ImageMediaType; base64: string }
  | { kind: "pdf"; base64: string }
  | { kind: "text"; text: string };

export type ExtractContext = {
  language: string; // OUTPUT_LANGUAGES code
  country: string;
  timezone: string;
  dateOrder: DateOrder;
  currency: string;
  weekStart: 0 | 1;
  childNames: string[];
  todayIso: string;
  hintChildName?: string | null;
};

export type ExtractOutput = {
  result: Extraction;
  model: string;
  mock: boolean;
  usage?: { input: number; output: number; cache_read: number; cache_write: number };
};

export class ExtractError extends Error {
  constructor(
    public code: "refused" | "parse_failed",
    message: string,
  ) {
    super(message);
  }
}

const MODEL = process.env.EXTRACT_MODEL || "claude-opus-5-5";
// The assistant jobs (questions, reply drafts) and the inbox classifier run on cheaper models.
export const ASSIST_MODEL = process.env.ASSIST_MODEL || "claude-sonnet-5-5";
export const CLASSIFY_MODEL = process.env.CLASSIFY_MODEL || "claude-haiku-5-5";

export const LANGUAGE_NAMES = Object.fromEntries(OUTPUT_LANGUAGES.map((l) => [l.code, l.prompt])) as Record<string, string>;

// Keep this block byte-stable: it sits in front of the cached generic knowledge note.
const RULES = `You are the engine of ParentDesk, a tool that turns school and family-admin communications into a family calendar and to-do list for busy parents anywhere in the world.

You receive ONE communication (photos or a PDF of a letter, newsletter, permission slip or form; a screenshot; or the pasted text of an e-mail, app notification or group-chat message; possibly several pages), plus the family's settings: country, result language, time zone, how dates are written locally, currency, the names of the children, and today's date. You return exactly one JSON object that follows the provided schema.

What to extract
- Everything a parent must put on a calendar or a to-do list: events (trips, picture day, concerts, sports, parent-teacher meetings, early dismissal, no-school days, holidays, exams, club sessions), deadlines (hand-ins, sign-ups, bookings), payments (fees, trips, lunch money, fundraisers), consent (slips, forms, permissions to sign and return), to-dos (things to prepare or do without a firm date), and at most two "info" items for facts that matter later (a new teacher's name, a changed pickup rule).
- Recurring things (PE on Tuesdays, library books due every Monday) become ONE item: the first occurrence on or after today as the date, the rule stated in the description. Set recurrence to the rhythm of the rule (daily, weekly, biweekly, monthly); "none" for one-off items.
- Skip pleasantries, thank-yous, general praise, and advertising. One newsletter usually holds 3 to 12 items. Never invent an item that the text does not support.
- Merge duplicates: the same trip mentioned three times is one event; its money and its slip are separate payment and consent items that share the trip's name.

Dates and times
- Give an ISO date only when the communication states it, or gives an unambiguous rule plus a reference. A weekday without a date means the next occurrence on or after the date of the communication (use today's date when the communication is undated) and confidence "medium". A date without a year is the next occurrence on or after today, within the current school year. "Next week", "later this month" without a day: date null, keep the words in the description.
- Read numeric dates with the family's local date order: with MDY, 03/04 is March 4; with DMY, 3 April; with YMD, year first. Say in the quote field which text you read.
- Times are 24-hour local time. "Noon" is 12:00. A time range sets time and end_time. All-day when no time is stated.
- A deadline, payment or consent item's date is its due date. If a slip is "due by" a day, use that day; if the notice says only "before the trip", use the day before the trip with confidence "medium".
- Never move a date earlier or later to be helpful; the parent's calendar will carry the reminder.
- Keep every item whose date the communication states, even when that date is already in the past (a letter can reach the parent late, or be added for the record). Never drop or skip an item because of its date; the app sorts past items under "past due" and the parent dismisses them. When the whole communication looks older than a month, say so in the summary.

Children
- The family's child names are given. Attach an item to a child only when the communication names the child, the class, grade or group that clearly belongs to that child, or the parent said which child it is about (the hint). Copy names exactly from the list. When unsure, leave children empty: the whole family sees it.

Money
- amount is a plain number; currency is the ISO code of the symbol or word used. If no symbol, use the family's currency.

Language and tone
- Write every free-text field (titles, descriptions, summary, questions, action_text, bring) in the target language, even when the communication is in another language. Keep the school's own name for an event in parentheses when it helps the parent recognise it on the paper, for example "Field trip (sortie scolaire)".
- Titles name the thing, short and concrete: "Science Museum trip", "Picture day", "Pay trip fee 12 USD", "Sign permission slip". Descriptions are one or two plain sentences with the facts a parent needs: where, how long, what it costs, who to contact.
- quote: copy the exact short phrase (in the original language) that states the date or requirement, so the parent can check it on the paper. Null if nothing specific.

Privacy
- Do not copy other families' children's full names, private phone numbers, home addresses, medical details, or payment card and account numbers into any field. School and office contact details are fine.

Not a notice
- If the input is not a school, class, club, camp, childcare or family-admin communication (a shopping receipt, a selfie, a news article, a blank page), set is_school_related=false, items empty, and say in summary what you see.

Mixed input
- The input may hold several messages at once: a group-chat export, a screenshot of a notification list, a batch of forwarded e-mails, or a week of a parent's inbox. Tell the messages apart, decide which come from a school, teacher, class representative, club, childcare, camp or other family-admin sender, and extract only from those. Skip chatter between parents, jokes, advertising, receipts and anything unrelated to the children's schedule.
- Set source.kind to "chat" for a chat export and "notification" for a notification list. messages_seen is the number of separate messages you could tell apart; messages_used is how many you took items from. For a single letter, e-mail or newsletter both are 1.
- is_school_related is true when at least one message was relevant. The title then names the channel and the period, for example "Class chat, 3 school messages (1-5 Nov)".

Questions for the parent
- At most three short questions for things the communication leaves unclear and that matter (which day the trip returns, whether siblings are included, how to pay). Empty when nothing is unclear.`;

type Pack = { generic: string; country: string | null };
const packCache = new Map<string, Pack>();

function readNote(name: string): string | null {
  const p = path.join(process.cwd(), "knowledge", "countries", `${name}.md`);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8").trim() : null;
}

export function loadPack(countryCode: string): Pack {
  const c = countryOf(countryCode);
  const key = c.pack ?? "_none";
  const cached = packCache.get(key);
  if (cached) return cached;
  const pack: Pack = { generic: readNote("_generic") ?? "", country: c.pack ? readNote(c.pack) : null };
  packCache.set(key, pack);
  return pack;
}

export function isMock(): boolean {
  if (process.env.MOCK_EXTRACT === "1") return true;
  return !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function contextLines(ctx: ExtractContext): string {
  const c = countryOf(ctx.country);
  const lines = [
    `Target language for all free-text fields: ${LANGUAGE_NAMES[ctx.language] ?? "English"}.`,
    `Family country: ${c.name} (${c.code}). Time zone: ${ctx.timezone}. Local date order: ${ctx.dateOrder} (${
      ctx.dateOrder === "MDY" ? "month/day/year" : ctx.dateOrder === "DMY" ? "day/month/year" : "year/month/day"
    }). Default currency: ${ctx.currency}. The school year usually starts in month ${c.schoolYearStart}.`,
    `Today's date: ${ctx.todayIso} (${DAY_NAMES[weekday(ctx.todayIso)]}).`,
    ctx.childNames.length ? `Children in this family: ${ctx.childNames.map((n) => `"${n}"`).join(", ")}.` : "Children in this family: none entered yet.",
  ];
  if (ctx.hintChildName) lines.push(`The parent says this communication is mainly about "${ctx.hintChildName}".`);
  lines.push("Extract the calendar items and to-dos from the attached communication and return the JSON.");
  return lines.join("\n");
}

// The extraction context of a family record (what every channel passes to extractNotice).
export function contextOf(rec: FamilyRecord, hintChildName?: string | null, todayIso?: string): ExtractContext {
  return {
    language: rec.settings.language,
    country: rec.settings.country,
    timezone: rec.settings.timezone,
    dateOrder: rec.settings.dateOrder,
    currency: rec.settings.currency,
    weekStart: rec.settings.weekStart,
    childNames: rec.children.map((c) => c.name),
    todayIso: todayIso ?? todayIn(rec.settings.timezone),
    hintChildName: hintChildName ?? null,
  };
}

export async function extractNotice(files: InputFile[], ctx: ExtractContext): Promise<ExtractOutput> {
  if (isMock()) return { result: mockExtraction(ctx), model: "mock", mock: true };

  const client = new Anthropic();
  const pack = loadPack(ctx.country);

  const content: Anthropic.Beta.BetaContentBlockParam[] = files.map((f): Anthropic.Beta.BetaContentBlockParam => {
    if (f.kind === "image") return { type: "image", source: { type: "base64", media_type: f.mediaType, data: f.base64 } };
    if (f.kind === "pdf") return { type: "document", source: { type: "base64", media_type: "application/pdf", data: f.base64 } };
    return { type: "text", text: `<communication_text>\n${f.text}\n</communication_text>` };
  });
  content.push({ type: "text", text: contextLines(ctx) });

  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: "text", text: RULES },
    {
      type: "text",
      text: `<general_notes>\n${pack.generic}\n</general_notes>`,
      cache_control: { type: "ephemeral", ttl: "1h" },
    },
  ];
  if (pack.country) system.push({ type: "text", text: `<country_notes country="${ctx.country}">\n${pack.country}\n</country_notes>` });

  const request = {
    model: MODEL,
    max_tokens: 8000,
    system,
    messages: [{ role: "user" as const, content }],
    output_config: { effort: "medium" as const, format: betaZodOutputFormat(ExtractionSchema) },
  };

  const response =
    process.env.ENABLE_FALLBACKS === "0"
      ? await client.beta.messages.parse(request)
      : await client.beta.messages.parse({ ...request, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });

  await noteUsage(response); // before anything can throw: a refusal used tokens too
  if (response.stop_reason === "refusal") {
    throw new ExtractError("refused", response.stop_details?.explanation ?? "The model declined this request.");
  }
  const parsed = response.parsed_output;
  if (!parsed) throw new ExtractError("parse_failed", "No structured output in the response.");

  return {
    result: parsed,
    model: response.model,
    mock: false,
    usage: {
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
      cache_read: response.usage.cache_read_input_tokens ?? 0,
      cache_write: response.usage.cache_creation_input_tokens ?? 0,
    },
  };
}

// Canned result used when no API key is configured, so the UI can be exercised. It mirrors
// the bundled sample newsletter, with dates placed relative to today.
export function mockExtraction(ctx: ExtractContext): Extraction {
  const t = ctx.todayIso;
  const { friday, wednesday, tuesdayAfter, thursdayAfter, monday, breakThursday: thanksgiving } = sampleDates(t);
  const kids = ctx.childNames.slice(0, 1);
  return {
    source: {
      title: "Room 12 news, week of " + addDays(t, 1),
      sender: "Oak Street Elementary, Room 12 (Ms. Rivera)",
      summary:
        "Weekly class newsletter. The main items are a Science Museum field trip with a permission slip and a 12 USD fee due two days before, picture day the following week, parent-teacher conferences, weekly library and PE reminders, and two no-school days for Thanksgiving.",
      language_detected: "en",
      kind: "newsletter",
      messages_seen: 1,
      messages_used: 1,
    },
    is_school_related: true,
    items: [
      {
        type: "event",
        title: "Science Museum field trip",
        description: "Bus leaves at 8:30 sharp. Pack a bag lunch and a water bottle.",
        date: friday,
        end_date: null,
        time: "08:30",
        end_time: null,
        all_day: false,
        location: "Science Museum",
        amount: null,
        currency: null,
        bring: ["Bag lunch", "Water bottle"],
        requires_action: true,
        action_text: "Pack lunch and water, be on time for the bus",
        children: kids,
        confidence: "high",
        recurrence: "none",
        quote: "Field trip to the Science Museum: Friday. Bus leaves at 8:30 AM sharp.",
      },
      {
        type: "consent",
        title: "Sign the field-trip permission slip",
        description: "Return the signed slip to the teacher before the trip.",
        date: wednesday,
        end_date: null,
        time: null,
        end_time: null,
        all_day: true,
        location: null,
        amount: null,
        currency: null,
        bring: [],
        requires_action: true,
        action_text: "Sign and return the slip",
        children: kids,
        confidence: "high",
        recurrence: "none",
        quote: "Permission slip and $12 due by Wednesday",
      },
      {
        type: "payment",
        title: "Pay the field-trip fee",
        description: "12 USD for the Science Museum trip, due with the permission slip.",
        date: wednesday,
        end_date: null,
        time: null,
        end_time: null,
        all_day: true,
        location: null,
        amount: 12,
        currency: "USD",
        bring: [],
        requires_action: true,
        action_text: "Pay 12 USD",
        children: kids,
        confidence: "high",
        recurrence: "none",
        quote: "Permission slip and $12 due by Wednesday",
      },
      {
        type: "event",
        title: "Picture day",
        description: "Order forms went home with the newsletter.",
        date: tuesdayAfter,
        end_date: null,
        time: null,
        end_time: null,
        all_day: true,
        location: null,
        amount: null,
        currency: null,
        bring: ["Order form if you want prints"],
        requires_action: false,
        action_text: null,
        children: kids,
        confidence: "high",
        recurrence: "none",
        quote: "Picture Day is Tuesday",
      },
      {
        type: "deadline",
        title: "Sign up for a parent-teacher conference slot",
        description: "Conferences run 15:30 to 19:00 on the Thursday; sign up online by Monday.",
        date: monday,
        end_date: null,
        time: null,
        end_time: null,
        all_day: true,
        location: null,
        amount: null,
        currency: null,
        bring: [],
        requires_action: true,
        action_text: "Book a slot online",
        children: kids,
        confidence: "medium",
        recurrence: "none",
        quote: "Sign up online by Monday.",
      },
      {
        type: "event",
        title: "Parent-teacher conferences",
        description: "Your booked slot is between 15:30 and 19:00.",
        date: thursdayAfter,
        end_date: null,
        time: "15:30",
        end_time: "19:00",
        all_day: false,
        location: "Room 12",
        amount: null,
        currency: null,
        bring: [],
        requires_action: true,
        action_text: "Attend your slot",
        children: kids,
        confidence: "high",
        recurrence: "none",
        quote: "Parent-teacher conferences: Thursday, 3:30-7:00 PM.",
      },
      {
        type: "todo",
        title: "Return library books (every Monday)",
        description: "Library books are due every Monday.",
        date: monday,
        end_date: null,
        time: null,
        end_time: null,
        all_day: true,
        location: null,
        amount: null,
        currency: null,
        bring: ["Library books"],
        requires_action: true,
        action_text: "Put the books in the backpack on Sunday night",
        children: kids,
        confidence: "high",
        recurrence: "weekly",
        quote: "library books are due every Monday",
      },
      {
        type: "info",
        title: "PE days: Tuesdays and Thursdays",
        description: "Sneakers on PE days.",
        date: nextWeekday(t, 2),
        end_date: null,
        time: null,
        end_time: null,
        all_day: true,
        location: null,
        amount: null,
        currency: null,
        bring: ["Sneakers"],
        requires_action: false,
        action_text: null,
        children: kids,
        confidence: "high",
        recurrence: "weekly",
        quote: "PE is Tuesdays and Thursdays - sneakers please!",
      },
      {
        type: "event",
        title: "No school (fall break)",
        description: "Two days off: Thursday and Friday.",
        date: thanksgiving,
        end_date: addDays(thanksgiving, 1),
        time: null,
        end_time: null,
        all_day: true,
        location: null,
        amount: null,
        currency: null,
        bring: [],
        requires_action: false,
        action_text: null,
        children: [],
        confidence: "high",
        recurrence: "none",
        quote: "No school Thursday and Friday (fall break)",
      },
    ],
    questions_for_parent: ["Does the field trip return before normal dismissal time?"],
  };
}

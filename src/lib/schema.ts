import { z } from "zod";

// What the model returns for one notice (a newsletter, letter, e-mail, chat message or
// form, possibly several pages). Every field is required; "unknown" is null, so the JSON
// schema for structured outputs stays simple.

export const ITEM_TYPES = ["event", "deadline", "todo", "payment", "consent", "info"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export const Confidence = z.enum(["high", "medium", "low"]);
export type ConfidenceLevel = z.infer<typeof Confidence>;

export const ExtractedItemSchema = z.object({
  type: z
    .enum(ITEM_TYPES)
    .describe(
      "event: something that happens at a date (trip, picture day, meeting, early dismissal, holiday, no-school day). deadline: something to hand in or do by a date. todo: a task without a firm date. payment: money to pay. consent: a form, slip or permission to sign and return. info: a useful fact with no action (at most two per notice).",
    ),
  title: z.string().describe("Short and specific, in the target language. Name the thing, not the school."),
  description: z.string().describe("One or two plain sentences with the details a parent needs."),
  date: z
    .string()
    .nullable()
    .describe("ISO YYYY-MM-DD: the day the event happens, or the due date for deadline, payment and consent. Null when not stated."),
  end_date: z.string().nullable().describe("ISO end date for multi-day events, else null."),
  time: z.string().nullable().describe("HH:MM 24-hour local start time, or null when all day or not stated."),
  end_time: z.string().nullable().describe("HH:MM 24-hour local end time, or null."),
  all_day: z.boolean(),
  location: z.string().nullable().describe("Place, if stated: room, school, venue, address."),
  amount: z.number().nullable().describe("Money amount as a plain number for payments, else null."),
  currency: z.string().nullable().describe("ISO 4217 code such as USD, GBP, EUR, KRW, JPY, or null."),
  bring: z.array(z.string()).describe("Things to bring, wear, pack or prepare. Empty when none."),
  requires_action: z.boolean().describe("True when a parent must do something: sign, pay, send, bring, reply, book, attend."),
  action_text: z.string().nullable().describe("The action in a few words, e.g. 'Sign and return the slip', else null."),
  children: z
    .array(z.string())
    .describe("Names copied exactly from the provided child list that this item applies to. Empty means the whole family or unknown."),
  recurrence: z
    .enum(["none", "daily", "weekly", "biweekly", "monthly"])
    .describe("How often this repeats when the communication states a rule (PE every Tuesday: weekly; library books every other Monday: biweekly). 'none' for one-off items."),
  confidence: Confidence.describe(
    "high: stated plainly in the notice. medium: inferred (a weekday without a date, 'next week', a date without a year). low: a guess.",
  ),
  quote: z
    .string()
    .nullable()
    .describe("The exact short phrase from the notice that states the date or the requirement, in the original language, so the parent can verify it."),
});
export type ExtractedItem = z.infer<typeof ExtractedItemSchema>;

export const ExtractionSchema = z.object({
  source: z.object({
    title: z.string().describe("A short name for this notice in the target language, e.g. 'Room 12 news, week of 10 November'."),
    sender: z.string().describe("School, class, teacher, club or organisation that sent it, as written. 'Unknown' if absent."),
    summary: z.string().describe("Two or three sentences: what the notice is about and the most important date or action."),
    language_detected: z.string().describe("BCP 47 code of the notice language, e.g. en, ko, ja, es, de."),
    kind: z
      .enum(["notice", "email", "message", "newsletter", "form", "chat", "notification", "other"])
      .describe("chat: a group-chat export or several messages at once. notification: a list or screenshot of app notifications."),
    messages_seen: z.number().int().describe("How many separate messages, e-mails or notices the input contained. 1 for a single letter or newsletter."),
    messages_used: z.number().int().describe("How many of them were school or family-admin communications that items were taken from."),
  }),
  is_school_related: z
    .boolean()
    .describe("False when the input is not a school, class, club, camp, childcare or family-admin communication."),
  items: z.array(ExtractedItemSchema),
  questions_for_parent: z
    .array(z.string())
    .describe("Things the notice leaves unclear that the parent should ask the school, as short questions. At most three."),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

// Languages the extractor can write results in. The UI itself is translated into the
// subset in i18n/locales.ts; the model writes any of these directly.
export const OUTPUT_LANGUAGES = [
  { code: "en", label: "English", prompt: "English" },
  { code: "ko", label: "한국어", prompt: "Korean (한국어)" },
  { code: "es", label: "Español", prompt: "Spanish (Español)" },
  { code: "ja", label: "日本語", prompt: "Japanese (日本語)" },
  { code: "zh", label: "中文", prompt: "Simplified Chinese (简体中文)" },
  { code: "zh-TW", label: "繁體中文", prompt: "Traditional Chinese (繁體中文)" },
  { code: "fr", label: "Français", prompt: "French (Français)" },
  { code: "de", label: "Deutsch", prompt: "German (Deutsch)" },
  { code: "pt", label: "Português", prompt: "Portuguese (Português)" },
  { code: "it", label: "Italiano", prompt: "Italian (Italiano)" },
  { code: "nl", label: "Nederlands", prompt: "Dutch (Nederlands)" },
  { code: "vi", label: "Tiếng Việt", prompt: "Vietnamese (Tiếng Việt)" },
  { code: "th", label: "ไทย", prompt: "Thai (ภาษาไทย)" },
  { code: "id", label: "Bahasa Indonesia", prompt: "Indonesian (Bahasa Indonesia)" },
  { code: "tl", label: "Filipino", prompt: "Filipino (Tagalog)" },
  { code: "hi", label: "हिन्दी", prompt: "Hindi (हिन्दी)" },
  { code: "ar", label: "العربية", prompt: "Arabic (العربية)" },
  { code: "tr", label: "Türkçe", prompt: "Turkish (Türkçe)" },
  { code: "pl", label: "Polski", prompt: "Polish (Polski)" },
  { code: "uk", label: "Українська", prompt: "Ukrainian (Українська)" },
  { code: "ru", label: "Русский", prompt: "Russian (Русский)" },
] as const;

export type OutputLanguage = (typeof OUTPUT_LANGUAGES)[number]["code"];

// ---- the smaller assistant jobs (lib/assist.ts) ----

export const AskSchema = z.object({
  answer: z.string().describe("The answer for the parent in the target language: short and concrete, dates written out with the weekday. Say plainly when the list has nothing about the question."),
  item_ids: z.array(z.string()).describe("Ids of the items the answer relies on, copied exactly. Empty when none."),
});
export type Ask = z.infer<typeof AskSchema>;

export const ReplySchema = z.object({
  reply: z.string().describe("The message to the school or teacher, ready to paste, in the reply language."),
  translation: z.string().nullable().describe("The same message in the family's language when it differs from the reply language, else null."),
  subject: z.string().nullable().describe("A subject line when the reply would go by e-mail, else null."),
});
export type Reply = z.infer<typeof ReplySchema>;

export const ClassifySchema = z.object({
  school: z.array(z.number().int()).describe("Zero-based indexes of the e-mails that are communications from a school, class, teacher, childcare, club, camp, tutoring or other family-admin sender."),
});
export type Classify = z.infer<typeof ClassifySchema>;

// A teacher's room post, translated for the families whose result language differs
// (lib/rooms.ts). Only the free-text fields travel; dates and amounts stay as extracted.
export const TranslatedPostSchema = z.object({
  title: z.string().describe("The notice title in the target language."),
  summary: z.string().describe("The summary in the target language."),
  items: z
    .array(
      z.object({
        title: z.string(),
        description: z.string(),
        action_text: z.string().nullable(),
        location: z.string().nullable().describe("Translated only when it is a description such as 'school gym'; a proper name stays as written."),
        bring: z.array(z.string()),
      }),
    )
    .describe("One entry per input item, in the same order."),
});
export type TranslatedPost = z.infer<typeof TranslatedPostSchema>;

// One item explained to a parent who may be new to this school system (lib/assist.ts).
export const ExplainSchema = z.object({
  explanation: z.string().describe("Two to four plain sentences in the target language: what this item is and why the school sends it. Keep the school's own term in parentheses the first time."),
  what_to_do: z.array(z.string()).describe("The concrete steps for the parent, in order, each a short sentence. At most four. Empty when nothing is required."),
  context: z.string().nullable().describe("One or two sentences of local or cultural background a newcomer would not know (how this is usually handled in this country, what is customary). Null when there is nothing worth saying."),
  ask_school: z.string().nullable().describe("One question the parent should ask the school if the notice leaves it unclear, else null."),
});
export type Explain = z.infer<typeof ExplainSchema>;

// A teacher's notice written from a few facts (lib/assist.ts composeNotice).
export const NOTICE_KINDS = ["trip", "event", "bring", "payment", "consent", "change", "general"] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

export const ComposeSchema = z.object({
  title: z.string().describe("A short title for the notice, in the target language."),
  notice: z.string().describe("The complete notice, ready to send to parents, in the target language."),
  missing: z.array(z.string()).describe("Facts the teacher still has to add before sending (a date, a price, a deadline, a place), each a few words. Empty when nothing essential is missing."),
});
export type Compose = z.infer<typeof ComposeSchema>;

// A parent's message understood and answered (lib/assist.ts helpParentMessage).
export const ParentMessageSchema = z.object({
  language: z.string().describe("BCP 47 code of the language the parent wrote in."),
  translation: z.string().describe("The parent's message in the teacher's language, faithful and complete."),
  summary: z.string().describe("One sentence in the teacher's language: what the parent asks or tells, and whether the teacher has to do something."),
  reply: z.string().describe("A suggested reply in the parent's language, in the polite register a teacher uses with parents there, ready to paste. Placeholders in brackets for facts the teacher must fill in."),
  reply_translated: z.string().describe("The same reply in the teacher's language."),
});
export type ParentMessage = z.infer<typeof ParentMessageSchema>;

export function isOutputLanguage(x: unknown): x is OutputLanguage {
  return typeof x === "string" && OUTPUT_LANGUAGES.some((l) => l.code === x);
}

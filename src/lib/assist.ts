import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { weekday } from "./dates";
import { ASSIST_MODEL, CLASSIFY_MODEL, LANGUAGE_NAMES, isMock } from "./extract";
import { AskSchema, ClassifySchema, ComposeSchema, ExplainSchema, OUTPUT_LANGUAGES, ParentMessageSchema, ReplySchema, AnnouncementTextsSchema, SettingsSuggestionSchema, TranslatedPostSchema, type Ask, type Classify, type Compose, type Explain, type NoticeKind, type ParentMessage, type AnnouncementTexts, type Reply, type SettingsSuggestion } from "./schema";
import { COUNTRIES, TIMEZONES, countryOf } from "./countries";
import type { ItemDraft } from "./store";
import { noteUsage } from "./usage";
import type { FamilyRecord, Item, Settings, Source } from "./types";

// The three smaller model jobs next to extraction: answering a parent's question from the
// saved list, drafting a reply to the school, and sorting an inbox. Each is one call with
// a structured result, on the cheaper assistant model.

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function languageName(code: string | null | undefined): string {
  if (!code) return "English";
  return LANGUAGE_NAMES[code] ?? LANGUAGE_NAMES[code.split("-")[0]] ?? code;
}

function byDate(a: Item, b: Item): number {
  if (!a.date && !b.date) return a.createdAt < b.createdAt ? 1 : -1;
  if (!a.date) return 1;
  if (!b.date) return -1;
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return (a.time ?? "99") < (b.time ?? "99") ? -1 : 1;
}

export function itemLine(it: Item, names: Map<string, string>): string {
  const kids = it.childIds.map((id) => names.get(id)).filter((n): n is string => Boolean(n));
  const when = it.date ? `${it.date}${it.end_date && it.end_date !== it.date ? `..${it.end_date}` : ""}${it.time ? ` ${it.time}` : ""}` : "(no date)";
  const parts = [`id=${it.id}`, `[${it.type}${it.status !== "open" ? `, ${it.status}` : ""}${it.confidence !== "high" ? ", please check" : ""}]`, when, `| ${it.title}`];
  if (kids.length) parts.push(`| child: ${kids.join(", ")}`);
  if (it.amount != null) parts.push(`| ${it.amount} ${it.currency ?? ""}`.trimEnd());
  if (it.location) parts.push(`| at ${it.location}`);
  if (it.bring.length) parts.push(`| bring: ${it.bring.join(", ")}`);
  if (it.action_text) parts.push(`| action: ${it.action_text}`);
  if (it.description) parts.push(`| ${it.description.slice(0, 160)}`);
  return parts.join(" ");
}

// Everything the assistant may know about the family, as compact lines.
export function familyBrief(rec: FamilyRecord, todayIso: string, limits = { open: 80, done: 15, sources: 8 }): string {
  const names = new Map(rec.children.map((c) => [c.id, c.name]));
  const open = rec.items.filter((it) => it.status === "open").sort(byDate).slice(0, limits.open);
  const done = rec.items
    .filter((it) => it.status !== "open")
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .slice(0, limits.done);
  const sources = [...rec.sources].sort((a, b) => (a.ts < b.ts ? 1 : -1)).slice(0, limits.sources);
  const s = rec.settings;
  const lines = [
    `Family: ${s.familyName || "(no name)"}. Country ${s.country}, language ${languageName(s.language)}, time zone ${s.timezone}, currency ${s.currency}.`,
    rec.children.length ? `Children: ${rec.children.map((c) => c.name).join(", ")}.` : "Children: none entered.",
    `Today: ${todayIso} (${DAY_NAMES[weekday(todayIso)]}).`,
    "",
    `Open items (${open.length}):`,
    ...(open.length ? open.map((it) => itemLine(it, names)) : ["(none)"]),
  ];
  if (done.length) lines.push("", "Recently done or dismissed:", ...done.map((it) => itemLine(it, names)));
  if (sources.length) lines.push("", "Notices:", ...sources.map((src) => `- ${src.ts.slice(0, 10)} ${src.title} (${src.sender}): ${src.summary.slice(0, 200)}`));
  return lines.join("\n");
}

const ASK_RULES = `You are the family assistant inside ParentDesk, a planning tool that turns school communications into a family calendar and to-do list. You answer a parent's question using ONLY the family's saved items and notices given below.

- Answer in the target language, briefly: one to five sentences, or a short list when several items match. Write dates with the weekday and the day, for example "Friday 20 November", and times in the family's local time.
- Rely only on the list. If nothing on the list answers the question, say so plainly and suggest adding the notice. Never invent dates, amounts or rules.
- When the question is about one child, use the items tagged with that child and the items with no child.
- Point out when an item is marked "please check" (its date was inferred) or is already done.
- Do not give medical, legal or financial advice. For anything beyond the list, say that the school's own notice is the authority.
- item_ids: the ids of the items the answer relies on, copied exactly as given. Empty when none.`;

export async function askAssistant(rec: FamilyRecord, question: string, todayIso: string): Promise<{ result: Ask; model: string; mock: boolean }> {
  const brief = familyBrief(rec, todayIso);
  if (isMock()) {
    const next = rec.items.filter((it) => it.status === "open" && it.date && it.date >= todayIso).sort(byDate).slice(0, 3);
    return {
      result: {
        answer: next.length ? `(demo) The next items on your list: ${next.map((it) => `${it.title} on ${it.date}`).join("; ")}.` : "(demo) Your list is empty.",
        item_ids: next.map((it) => it.id),
      },
      model: "mock",
      mock: true,
    };
  }
  const client = new Anthropic();
  const response = await client.beta.messages.parse({
    model: ASSIST_MODEL,
    max_tokens: 1200,
    system: [{ type: "text", text: ASK_RULES }],
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: `<family>\n${brief}\n</family>` },
          { type: "text", text: `Target language: ${languageName(rec.settings.language)}.\n<question>\n${question}\n</question>` },
        ],
      },
    ],
    output_config: { effort: "low", format: betaZodOutputFormat(AskSchema) },
  });
  await noteUsage(response);
  if (!response.parsed_output) throw new Error("no structured output");
  return { result: response.parsed_output, model: response.model, mock: false };
}

const REPLY_RULES = `You write short messages from a parent to a school, teacher, class group or club, based on one item from ParentDesk and the parent's intent.

- Write in the reply language given (the language the notice was written in), with the polite register a parent uses with a teacher in that culture: Korean 존댓말, Japanese です・ます, German Sie, formal Spanish and French. Three to six sentences, ready to paste into an e-mail, a reply slip or a chat message. Plain and warm, no flourishes.
- Say who you are: "the parent of <child name>" when a child is known, otherwise write "[child's name]". Sign off with "[your name]". Never invent facts: when a detail such as a time or a reason is not given, leave a bracketed placeholder for the parent to fill.
- Match the intent. yes: confirm attendance, give consent or confirm the payment. no: decline politely. absence: announce that the child will be absent or late and ask what to catch up on. question: ask the parent's question about this item. custom: follow the parent's note.
- Name the specific thing (the event and its date) so the teacher knows which item it is about.
- translation: when the family's language differs from the reply language, give the same message in the family's language so the parent knows what they are sending; otherwise null.
- subject: a short subject line in the reply language for an e-mail, or null for a chat-style reply.`;

export type ReplyIntent = "yes" | "no" | "absence" | "question" | "custom";
export const REPLY_INTENTS: ReplyIntent[] = ["yes", "no", "absence", "question", "custom"];

export async function draftReply(
  rec: FamilyRecord,
  item: Item,
  source: Source | null,
  intent: ReplyIntent,
  note: string,
  todayIso: string,
): Promise<{ result: Reply; model: string; mock: boolean }> {
  const names = new Map(rec.children.map((c) => [c.id, c.name]));
  const replyLanguage = languageName(source?.language || rec.settings.language);
  const familyLanguage = languageName(rec.settings.language);
  if (isMock()) {
    return {
      result: {
        reply: `(demo) Dear teacher, this is the parent of ${item.childIds.map((id) => names.get(id)).filter(Boolean).join(", ") || "[child's name]"}. Regarding "${item.title}"${item.date ? ` on ${item.date}` : ""}: ${intent}. ${note}\n[your name]`.trim(),
        translation: null,
        subject: item.title,
      },
      model: "mock",
      mock: true,
    };
  }
  const client = new Anthropic();
  const lines = [
    `<item>\n${itemLine(item, names)}\n</item>`,
    source ? `<notice>\nTitle: ${source.title}\nFrom: ${source.sender}\nSummary: ${source.summary}\n</notice>` : "",
    item.quote ? `<quote>${item.quote}</quote>` : "",
    `<request>\nIntent: ${intent}\nParent's note: ${note || "(none)"}\nReply language: ${replyLanguage}\nFamily language: ${familyLanguage}\nToday: ${todayIso}\n</request>`,
  ].filter(Boolean);
  const response = await client.beta.messages.parse({
    model: ASSIST_MODEL,
    max_tokens: 1000,
    system: [{ type: "text", text: REPLY_RULES }],
    messages: [{ role: "user", content: [{ type: "text", text: lines.join("\n") }] }],
    output_config: { effort: "low", format: betaZodOutputFormat(ReplySchema) },
  });
  await noteUsage(response);
  if (!response.parsed_output) throw new Error("no structured output");
  return { result: response.parsed_output, model: response.model, mock: false };
}

const CLASSIFY_RULES = `You sort a parent's inbox. For each e-mail you get its index, sender, subject and a snippet. Return the indexes of the e-mails that come from a school, kindergarten, nursery, childcare, class teacher, class parent group, PTA, school lunch or bus service, after-school club, sports club, camp, tutoring centre, music or language school, or another organisation that communicates dates, fees, forms or things to bring for the family's children. Exclude promotions, shop and brand newsletters, receipts and order confirmations, social-network notifications, personal mail, bank and utility mail, and anything not about the children's schedule. When unsure, include it: the next step reads the full e-mail and skips what is not a notice.`;

export type MailHead = { from: string; subject: string; snippet: string };

export async function classifyEmails(heads: MailHead[], fallback: (h: MailHead) => boolean): Promise<{ picked: number[]; model: string; mock: boolean }> {
  if (heads.length === 0) return { picked: [], model: "none", mock: false };
  if (isMock()) return { picked: heads.map((h, i) => (fallback(h) ? i : -1)).filter((i) => i >= 0), model: "mock", mock: true };
  const client = new Anthropic();
  const listing = heads.map((h, i) => `#${i} From: ${h.from}\n   Subject: ${h.subject}\n   Snippet: ${h.snippet.slice(0, 160)}`).join("\n");
  const response = await client.beta.messages.parse({
    model: CLASSIFY_MODEL,
    max_tokens: 600,
    system: [{ type: "text", text: CLASSIFY_RULES }],
    messages: [{ role: "user", content: [{ type: "text", text: `<emails>\n${listing}\n</emails>` }] }],
    output_config: { effort: "low", format: betaZodOutputFormat(ClassifySchema) },
  });
  await noteUsage(response);
  const parsed: Classify | null = response.parsed_output;
  if (!parsed) throw new Error("no structured output");
  const picked = [...new Set(parsed.school.filter((i) => Number.isInteger(i) && i >= 0 && i < heads.length))];
  return { picked, model: response.model, mock: false };
}

const TRANSLATE_RULES = `You translate one school notice that a teacher posted through ParentDesk, so that a family who reads another language gets the same dates and to-dos in theirs.

- Translate every free-text field into the target language: the title, the summary, and for each item its title, description, action_text and bring list. Keep the meaning exact; do not add, drop or reorder items. Return exactly one entry per item, in the given order.
- Keep proper names (the school, a museum, a person), amounts, dates and times as they are. A place that is a description ("school gym", "front gate") is translated; a proper name is not.
- Keep the school's own name for an event in parentheses when it helps the parent recognise it on the paper.
- Use the register a school uses with parents in the target language (Korean 존댓말, Japanese です・ます, German Sie).`;

export type PostText = { title: string; summary: string; items: ItemDraft[] };

// One call per target language; the result keeps every non-text field of the items.
export async function translatePost(post: PostText, fromLanguage: string, toLanguage: string): Promise<{ result: PostText; model: string; mock: boolean }> {
  if (isMock()) {
    const tag = `[${toLanguage}] `;
    return {
      result: { title: tag + post.title, summary: tag + post.summary, items: post.items.map((it) => ({ ...it, title: tag + it.title })) },
      model: "mock",
      mock: true,
    };
  }
  const client = new Anthropic();
  const listing = post.items
    .map((it, i) => `#${i} title: ${it.title}\n   description: ${it.description}\n   action_text: ${it.action_text ?? "(null)"}\n   location: ${it.location ?? "(null)"}\n   bring: ${it.bring.length ? it.bring.join(" | ") : "(none)"}`)
    .join("\n");
  const response = await client.beta.messages.parse({
    model: ASSIST_MODEL,
    max_tokens: 4000,
    system: [{ type: "text", text: TRANSLATE_RULES }],
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: `Source language: ${languageName(fromLanguage)}. Target language: ${languageName(toLanguage)}.` },
          { type: "text", text: `<notice>\nTitle: ${post.title}\nSummary: ${post.summary}\n</notice>\n<items>\n${listing}\n</items>` },
        ],
      },
    ],
    output_config: { effort: "low", format: betaZodOutputFormat(TranslatedPostSchema) },
  });
  await noteUsage(response);
  const parsed = response.parsed_output;
  if (!parsed) throw new Error("no structured output");
  const items = post.items.map((it, i) => {
    const tr = parsed.items[i];
    if (!tr) return it;
    return {
      ...it,
      title: (tr.title || it.title).slice(0, 160),
      description: (tr.description || it.description).slice(0, 1000),
      action_text: it.action_text ? (tr.action_text || it.action_text).slice(0, 200) : null,
      location: it.location ? (tr.location || it.location).slice(0, 200) : null,
      bring: tr.bring.length === it.bring.length ? tr.bring.map((b) => b.slice(0, 80)) : it.bring,
    };
  });
  return { result: { title: (parsed.title || post.title).slice(0, 160), summary: (parsed.summary || post.summary).slice(0, 1200), items }, model: response.model, mock: false };
}

const EXPLAIN_RULES = `You explain one item from a school communication to a parent, inside ParentDesk. Many parents are new to the country or to its school system, or read the school's language with effort; write for them.

- Write in the target language, plainly, as a helpful school office clerk would: what this is, why the school sends it, what exactly the parent has to do and by when. Keep the school's own term in parentheses the first time (for example "picture day (사진 촬영일)").
- Use only the item, the notice summary and the quoted line. Never invent dates, amounts, places or rules; when something is not stated, say so and put it in ask_school.
- context: what a newcomer would not know about how this is usually done in the family's country (customs, what other parents usually do, what is optional). Keep it to two sentences. Null when there is nothing useful.
- Do not give medical, legal or financial advice. The school's notice is the authority.`;

export async function explainItem(rec: FamilyRecord, item: Item, source: Source | null, todayIso: string): Promise<{ result: Explain; model: string; mock: boolean }> {
  const names = new Map(rec.children.map((c) => [c.id, c.name]));
  if (isMock()) {
    return {
      result: {
        explanation: `(demo) "${item.title}" is a ${item.type} from the school${item.date ? ` for ${item.date}` : ""}. ${item.description}`.trim(),
        what_to_do: item.requires_action ? [item.action_text ?? "Do what the notice asks.", "Tick it off here when it is done."] : [],
        context: "(demo) In demo mode there is no model; this text is canned.",
        ask_school: item.confidence !== "high" ? "Please confirm the exact date." : null,
      },
      model: "mock",
      mock: true,
    };
  }
  const client = new Anthropic();
  const country = countryOf(rec.settings.country);
  const lines = [
    `<item>\n${itemLine(item, names)}\n</item>`,
    source ? `<notice>\nTitle: ${source.title}\nFrom: ${source.sender}\nSummary: ${source.summary}\n</notice>` : "",
    item.quote ? `<quote>${item.quote}</quote>` : "",
    `<family>\nCountry: ${country.name} (${country.code}). Target language: ${languageName(rec.settings.language)}. Today: ${todayIso}.\n</family>`,
  ].filter(Boolean);
  const response = await client.beta.messages.parse({
    model: ASSIST_MODEL,
    max_tokens: 900,
    system: [{ type: "text", text: EXPLAIN_RULES }],
    messages: [{ role: "user", content: [{ type: "text", text: lines.join("\n") }] }],
    output_config: { effort: "low", format: betaZodOutputFormat(ExplainSchema) },
  });
  await noteUsage(response);
  if (!response.parsed_output) throw new Error("no structured output");
  const r = response.parsed_output;
  return { result: { ...r, what_to_do: r.what_to_do.slice(0, 4).map((x) => x.slice(0, 200)), explanation: r.explanation.slice(0, 1200) }, model: response.model, mock: false };
}

// ---- the teacher's side ----

export type TeacherLike = { name: string; school: string; settings: Settings };

export type ComposeInput = { kind: NoticeKind; facts: string; tone: "formal" | "friendly" };

const COMPOSE_RULES = `You write notices from a teacher to the parents of a class, inside ParentDesk. The teacher gives you the facts in a few words; you return a complete notice parents can act on.

- Write in the target language, in the register teachers use with parents in that country (Korean 존댓말 as in a 가정통신문, Japanese です・ます, German Sie, formal Spanish and French). The tone setting shifts it slightly: "formal" is an official letter, "friendly" is a warm class note. No emojis.
- Structure: a greeting, why you are writing, the details in a clear order (what, when, where, cost, what to bring, how and by when to reply or pay), what parents must do, where to ask, a sign-off with the teacher's name, school and class.
- Use every fact the teacher gave. Never invent a date, a time, a price, a place or a rule. When an essential fact for this kind of notice is missing, write a bracketed placeholder in the notice, such as [date], and list it in "missing".
- Write dates with the weekday. Keep it to 120 to 250 words. Plain sentences; a parent reading on a phone must get it in one pass.`;

export async function composeNotice(teacher: TeacherLike, roomName: string, input: ComposeInput, todayIso: string): Promise<{ result: Compose; model: string; mock: boolean }> {
  const target = languageName(teacher.settings.language);
  const country = countryOf(teacher.settings.country);
  const signature = [teacher.school, roomName, teacher.name].filter(Boolean).join(" · ");
  if (isMock()) {
    return {
      result: {
        title: `(demo) ${input.kind}: ${input.facts.slice(0, 40)}`,
        notice: `(demo) Dear parents,\n\n${input.facts}\n\nPlease let us know if you have questions.\n\n${signature}`,
        missing: /\d/.test(input.facts) ? [] : ["date"],
      },
      model: "mock",
      mock: true,
    };
  }
  const client = new Anthropic();
  const response = await client.beta.messages.parse({
    model: ASSIST_MODEL,
    max_tokens: 1500,
    system: [{ type: "text", text: COMPOSE_RULES }],
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `<teacher>\nName: ${teacher.name}\nSchool: ${teacher.school || "(not given)"}\nClass: ${roomName}\nCountry: ${country.name} (${country.code})\nTarget language: ${target}\nToday: ${todayIso}\n</teacher>\n<request>\nKind: ${input.kind}\nTone: ${input.tone}\nFacts:\n${input.facts}\n</request>`,
          },
        ],
      },
    ],
    output_config: { effort: "low", format: betaZodOutputFormat(ComposeSchema) },
  });
  await noteUsage(response);
  if (!response.parsed_output) throw new Error("no structured output");
  const r = response.parsed_output;
  return { result: { title: r.title.slice(0, 160), notice: r.notice.slice(0, 6000), missing: r.missing.slice(0, 6).map((m) => m.slice(0, 80)) }, model: response.model, mock: false };
}

const PARENT_MESSAGE_RULES = `A teacher received a message from a parent, possibly in a language the teacher does not read. Help the teacher understand it and answer it, inside ParentDesk.

- Translate the message faithfully into the teacher's language; keep names, dates and amounts as written.
- summary: one sentence in the teacher's language saying what the parent wants and whether the teacher needs to act (reply, confirm, forward to the office).
- reply: a suggested answer in the parent's language, in the polite register a teacher uses with parents there, three to six sentences, ready to paste. Never invent facts: put what the teacher must decide in brackets, for example [date] or [yes/no].
- reply_translated: the same reply in the teacher's language, so the teacher knows exactly what they are sending.
- Do not give medical, legal or financial advice.`;

export async function helpParentMessage(teacher: TeacherLike, text: string, todayIso: string): Promise<{ result: ParentMessage; model: string; mock: boolean }> {
  const mine = languageName(teacher.settings.language);
  if (isMock()) {
    return {
      result: {
        language: "und",
        translation: `(demo) ${text}`,
        summary: "(demo) A parent wrote to you. Demo mode has no model.",
        reply: `(demo) Thank you for your message. [your answer]\n${teacher.name}`,
        reply_translated: `(demo) Thank you for your message. [your answer]`,
      },
      model: "mock",
      mock: true,
    };
  }
  const client = new Anthropic();
  const response = await client.beta.messages.parse({
    model: ASSIST_MODEL,
    max_tokens: 1500,
    system: [{ type: "text", text: PARENT_MESSAGE_RULES }],
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: `<teacher>\nName: ${teacher.name}\nLanguage: ${mine}\nCountry: ${countryOf(teacher.settings.country).name}\nToday: ${todayIso}\n</teacher>` },
          { type: "text", text: `<parent_message>\n${text}\n</parent_message>` },
        ],
      },
    ],
    output_config: { effort: "low", format: betaZodOutputFormat(ParentMessageSchema) },
  });
  await noteUsage(response);
  if (!response.parsed_output) throw new Error("no structured output");
  const r = response.parsed_output;
  return { result: { ...r, translation: r.translation.slice(0, 4000), reply: r.reply.slice(0, 3000), reply_translated: r.reply_translated.slice(0, 3000), summary: r.summary.slice(0, 400) }, model: response.model, mock: false };
}

const SETUP_RULES = `You change the settings of a family's ParentDesk account from what a parent says in plain words, or answer a short question about the settings. ParentDesk turns school notices into a family calendar and to-do list.

- Fill only the fields the parent clearly asks to change; everything else stays null (lists empty). Never guess.
- A move to another country: set country only; the app derives time zone, currency, date order and week start from it unless the parent names them.
- country, language and timezone values must come from the lists given. If a country is not on the list, use "XX" and say so in the reply.
- Children: add, remove or rename by first name or nickname only. Never ask for or record birth dates or school names.
- Family members: when the parent adds or removes an adult, return the complete new list, built from the current list.
- When the parent asks how to do something (put items on the phone's calendar, install the app on the home screen, invite a partner, forward e-mails, phone automation, class rooms), answer in one or two plain sentences, set section to the matching section, and change nothing.
- reply: in the target language, warm and plain, one or two sentences. When something changes, say what in words. When the request is unclear, say what you need; never pretend to have done something.`;

// "Add my second child Mia", "we moved to Japan": plain words to a settings suggestion.
export async function suggestSettings(rec: FamilyRecord, text: string, uiLocale: string, todayIso: string): Promise<{ result: SettingsSuggestion; model: string; mock: boolean }> {
  const s = rec.settings;
  if (isMock()) {
    const lower = text.toLowerCase();
    const country = COUNTRIES.find((c) => c.code !== "XX" && lower.includes(c.name.toLowerCase())) ?? null;
    const week = /sunday|일요일/.test(lower) ? "sunday" : /monday|월요일/.test(lower) ? "monday" : null;
    const section = /calendar|캘린더/.test(lower) ? "calendar" : /install|home screen|홈 화면/.test(lower) ? "install" : null;
    return {
      result: {
        reply: country || week ? "(demo) Here is what would change." : section ? "(demo) The section to look at is marked below." : "(demo) The settings assistant needs the model; nothing changed.",
        settings: { familyName: null, country: country?.code ?? null, language: null, timezone: null, currency: null, dateOrder: null, weekStartsOn: week, digestEmail: null, digest: null, members: null },
        children: { add: [], remove: [], rename: [] },
        section,
      },
      model: "mock",
      mock: true,
    };
  }
  const context = [
    `Current settings: family name "${s.familyName}", country ${s.country}, result language ${s.language}, time zone ${s.timezone}, currency ${s.currency}, date order ${s.dateOrder}, week starts on ${s.weekStart === 0 ? "sunday" : "monday"}, weekly summary ${s.digest ? "on" : "off"}, summary e-mail "${s.digestEmail}".`,
    `Children: ${rec.children.map((c) => c.name).join(", ") || "(none)"}.`,
    `Family members: ${(s.members ?? []).join(", ") || "(none)"}.`,
    `Countries (code name): ${COUNTRIES.map((c) => `${c.code} ${c.name}`).join("; ")}.`,
    `Result languages (code label): ${OUTPUT_LANGUAGES.map((l) => `${l.code} ${l.label}`).join("; ")}.`,
    `Time zones: ${TIMEZONES.join(", ")}.`,
    `Today: ${todayIso}.`,
  ].join("\n");
  const client = new Anthropic();
  const response = await client.beta.messages.parse({
    model: ASSIST_MODEL,
    max_tokens: 800,
    system: [{ type: "text", text: SETUP_RULES }],
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: `<settings>\n${context}\n</settings>` },
          { type: "text", text: `Target language: ${languageName(uiLocale)}.\n<request>\n${text}\n</request>` },
        ],
      },
    ],
    output_config: { effort: "low", format: betaZodOutputFormat(SettingsSuggestionSchema) },
  });
  await noteUsage(response);
  if (!response.parsed_output) throw new Error("no structured output");
  return { result: response.parsed_output, model: response.model, mock: false };
}

// A short service announcement, written once by the operator, in every UI language.
export async function translateAnnouncement(text: string): Promise<{ result: AnnouncementTexts; model: string; mock: boolean }> {
  if (isMock()) {
    const same = { en: text, ko: text, es: text, ja: text, zh: text, fr: text, de: text, pt: text, it: text, vi: text };
    return { result: same, model: "mock", mock: true };
  }
  const client = new Anthropic();
  const response = await client.beta.messages.parse({
    model: ASSIST_MODEL,
    max_tokens: 2500,
    system: [
      {
        type: "text",
        text: "You translate a short service announcement from the operator of ParentDesk (a school-notice planner for parents and teachers) into ten languages: en English, ko Korean, es Spanish, ja Japanese, zh Simplified Chinese, fr French, de German, pt Portuguese, it Italian, vi Vietnamese. Keep it as short and plain as the original, keep dates, times and numbers exactly, add nothing and leave nothing out. The field for the language the announcement is already written in gets the original text unchanged.",
      },
    ],
    messages: [{ role: "user", content: [{ type: "text", text: `<announcement>\n${text}\n</announcement>` }] }],
    output_config: { effort: "low", format: betaZodOutputFormat(AnnouncementTextsSchema) },
  });
  await noteUsage(response);
  if (!response.parsed_output) throw new Error("no structured output");
  return { result: response.parsed_output, model: response.model, mock: false };
}

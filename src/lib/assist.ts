import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { weekday } from "./dates";
import { ASSIST_MODEL, CLASSIFY_MODEL, LANGUAGE_NAMES, isMock } from "./extract";
import { AskSchema, ClassifySchema, ReplySchema, type Ask, type Classify, type Reply } from "./schema";
import type { FamilyRecord, Item, Source } from "./types";

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
  const parsed: Classify | null = response.parsed_output;
  if (!parsed) throw new Error("no structured output");
  const picked = [...new Set(parsed.school.filter((i) => Number.isInteger(i) && i >= 0 && i < heads.length))];
  return { picked, model: response.model, mock: false };
}

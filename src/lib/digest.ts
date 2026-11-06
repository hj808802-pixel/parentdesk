import { cryptoReady, sign, verifySignature } from "./crypto";
import { addDays, formatDate, formatMoney, formatTime } from "./dates";
import { fmt, getDict, LOCALE_TAGS, isLocale, localePath, type Dict, type Locale } from "./i18n";
import type { FamilyRecord, Item } from "./types";

// The weekly summary e-mail: what is past due, what is due in the coming two weeks, what
// to pay and what to sign, written in the family's UI language with no model call. Sent
// through Resend (RESEND_API_KEY + DIGEST_FROM); without those the summary can still be
// previewed in the app.

export type DigestContent = { subject: string; text: string; html: string; count: number };

// The language of the summary: the UI language the family saved, else the result
// language when it is also a UI language, else the caller's fallback (the request's
// locale for a preview, English for the cron).
export function digestLocale(rec: FamilyRecord, fallback = "en"): Locale {
  const s = rec.settings;
  if (isLocale(s.locale)) return s.locale;
  if (isLocale(s.language)) return s.language;
  return isLocale(fallback) ? fallback : "en";
}

function byDate(a: Item, b: Item): number {
  if (!a.date && !b.date) return a.createdAt < b.createdAt ? 1 : -1;
  if (!a.date) return 1;
  if (!b.date) return -1;
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return (a.time ?? "99") < (b.time ?? "99") ? -1 : 1;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function buildDigest(rec: FamilyRecord, todayIso: string, opts: { origin: string; unsubscribeUrl?: string | null; dict?: Dict; fallbackLocale?: string }): DigestContent {
  const locale = digestLocale(rec, opts.fallbackLocale);
  const t = opts.dict ?? getDict(locale);
  const tag = LOCALE_TAGS[locale];
  const names = new Map(rec.children.map((c) => [c.id, c.name]));
  const open = rec.items.filter((it) => it.status === "open").sort(byDate);
  const in6 = addDays(todayIso, 6);
  const in13 = addDays(todayIso, 13);
  const in30 = addDays(todayIso, 30);
  const back30 = addDays(todayIso, -30);

  const overdue = open.filter((it) => it.date && it.date < todayIso && it.date >= back30);
  const thisWeek = open.filter((it) => it.date && it.date >= todayIso && it.date <= in6);
  const nextWeek = open.filter((it) => it.date && it.date > in6 && it.date <= in13);
  const toPay = open.filter((it) => it.type === "payment" && (!it.date || it.date <= in30));
  const toSign = open.filter((it) => it.type === "consent" && (!it.date || it.date <= in30));
  const noDate = open.filter((it) => !it.date && it.requires_action && it.type !== "payment" && it.type !== "consent").slice(0, 5);
  const count = new Set([...overdue, ...thisWeek, ...nextWeek].map((it) => it.id)).size;

  const line = (it: Item): string => {
    const when = it.date ? `${formatDate(it.date, tag)}${it.time ? ` ${formatTime(it.time, tag)}` : ""}` : "";
    const kids = it.childIds.map((id) => names.get(id)).filter((n): n is string => Boolean(n));
    const parts = [when, t.item.types[it.type], it.title];
    if (kids.length) parts.push(kids.join(", "));
    if (it.amount != null) parts.push(formatMoney(it.amount, it.currency, tag));
    if (it.bring.length) parts.push(`${t.item.bring}: ${it.bring.join(", ")}`);
    return parts.filter(Boolean).join(" · ");
  };
  const total = (items: Item[]): string => {
    const sums = new Map<string, number>();
    for (const it of items) if (it.amount != null) sums.set(it.currency ?? rec.settings.currency, (sums.get(it.currency ?? rec.settings.currency) ?? 0) + it.amount);
    return [...sums].map(([cur, n]) => formatMoney(n, cur, tag)).join(" + ");
  };

  const sections: { title: string; items: Item[]; extra?: string }[] = [
    { title: t.home.buckets.overdue, items: overdue },
    { title: t.home.buckets.thisWeek, items: thisWeek },
    { title: t.home.buckets.nextWeek, items: nextWeek },
    { title: t.digest.toPay, items: toPay, extra: total(toPay) },
    { title: t.digest.toSign, items: toSign },
    { title: t.digest.noDateAction, items: noDate },
  ].filter((s) => s.items.length > 0);

  const name = rec.settings.familyName.trim();
  const subject = count === 0 ? t.digest.subjectNone : name ? fmt(t.digest.subject, { name, n: count }) : fmt(t.digest.subjectNoName, { n: count });
  const appUrl = `${opts.origin}${localePath(locale, "/")}`;

  const textParts: string[] = [subject, "", t.digest.intro, ""];
  const htmlParts: string[] = [
    `<p style="margin:0 0 16px;color:#52525b">${esc(t.digest.intro)}</p>`,
  ];
  if (sections.length === 0) {
    textParts.push(t.digest.none);
    htmlParts.push(`<p style="margin:0 0 16px">${esc(t.digest.none)}</p>`);
  }
  for (const s of sections) {
    textParts.push(`## ${s.title}${s.extra ? ` (${s.extra})` : ""}`);
    for (const it of s.items) textParts.push(`- ${line(it)}`);
    textParts.push("");
    htmlParts.push(`<h2 style="font-size:15px;margin:20px 0 6px">${esc(s.title)}${s.extra ? ` <span style="font-weight:normal;color:#52525b">(${esc(s.extra)})</span>` : ""}</h2>`);
    htmlParts.push(`<ul style="margin:0;padding-left:18px">${s.items.map((it) => `<li style="margin:4px 0">${esc(line(it))}</li>`).join("")}</ul>`);
  }
  textParts.push(`${t.digest.openApp}: ${appUrl}`);
  if (opts.unsubscribeUrl) textParts.push(`${t.digest.unsubscribe}: ${opts.unsubscribeUrl}`);
  textParts.push("", t.digest.footer);

  const html = `<!doctype html><html lang="${tag}"><body dir="auto" style="margin:0;padding:24px;background:#fafafa;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#18181b;font-size:15px;line-height:1.5">
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e4e4e7;border-radius:16px;padding:24px">
<p style="margin:0 0 4px;font-size:12px;color:#6366f1;font-weight:600">ParentDesk</p>
<h1 style="font-size:20px;margin:0 0 12px">${esc(subject)}</h1>
${htmlParts.join("\n")}
<p style="margin:24px 0 0"><a href="${esc(appUrl)}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 18px;border-radius:999px;font-weight:600">${esc(t.digest.openApp)}</a></p>
<p style="margin:24px 0 0;font-size:12px;color:#71717a">${esc(t.digest.footer)}${opts.unsubscribeUrl ? ` <a href="${esc(opts.unsubscribeUrl)}" style="color:#71717a">${esc(t.digest.unsubscribe)}</a>` : ""}</p>
</div></body></html>`;

  return { subject, text: textParts.join("\n"), html, count };
}

// ---- unsubscribe links: "<family id>.<signature>", no login needed ----

export function unsubscribeToken(familyId: string): string | null {
  if (!cryptoReady()) return null;
  return `${familyId}.${sign(`unsub:${familyId}`)}`;
}

export function parseUnsubscribeToken(token: unknown): string | null {
  if (typeof token !== "string" || !cryptoReady()) return null;
  const m = /^([0-9a-f]{12})\.([A-Za-z0-9_-]{20,})$/.exec(token.trim());
  if (!m) return null;
  return verifySignature(`unsub:${m[1]}`, m[2]) ? m[1] : null;
}

// ---- sending ----

export class MailError extends Error {
  constructor(
    public code: "off" | "api",
    message: string,
  ) {
    super(message);
  }
}

export async function sendEmail(
  msg: { to: string; subject: string; text: string; html: string; unsubscribeUrl?: string | null },
  fetchImpl: typeof fetch = fetch,
): Promise<{ id: string }> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.DIGEST_FROM;
  if (!key || !from) throw new MailError("off", "RESEND_API_KEY or DIGEST_FROM is not set");
  const headers: Record<string, string> = {};
  if (msg.unsubscribeUrl) {
    headers["List-Unsubscribe"] = `<${msg.unsubscribeUrl}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }
  const res = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html, headers }),
  });
  const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!res.ok) throw new MailError("api", body.message ?? `resend ${res.status}`);
  return { id: body.id ?? "" };
}

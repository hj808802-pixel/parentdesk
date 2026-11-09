import type { SettingsSuggestion } from "./schema";
import { CHILD_COLORS, MAX_CHILDREN, type Child, type Settings } from "./types";

// The easy-setup helpers: one-tap calendar links per calendar app, which device this is,
// and how a spoken settings request becomes a settings patch. Client-safe (no Node).

export type Platform = "apple" | "android" | "other";

export function platformOf(ua: string, touchPoints = 0): Platform {
  if (/iPhone|iPad|iPod/i.test(ua)) return "apple";
  if (/Android/i.test(ua)) return "android";
  // iPadOS reports itself as a Mac; a Mac subscribes through webcal as well.
  if (/Macintosh/.test(ua)) return touchPoints > 1 ? "apple" : "apple";
  return "other";
}

// Google and Outlook open their "add this calendar?" page with the address filled in;
// Apple devices subscribe straight from a webcal: link.
export function calendarLinks(feed: string, name: string): { google: string; apple: string; outlook: string } {
  const webcal = feed.replace(/^https?:\/\//, "webcal://");
  return {
    google: `https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(feed)}`,
    apple: webcal,
    outlook: `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(feed)}&name=${encodeURIComponent(name || "ParentDesk")}`,
  };
}

// Per-device flags ("the calendar was added on this phone"); the browser's storage may
// be unavailable, in which case the flag is simply never set.
export const FLAG_CALENDAR = "pd_calendar_linked";
export const FLAG_INSTALLED = "pd_installed";
export const FLAG_SETUP_HIDDEN = "pd_setup_hidden";

export function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function writeFlag(key: string, on = true) {
  try {
    if (on) window.localStorage.setItem(key, "1");
    else window.localStorage.removeItem(key);
  } catch {
    /* storage unavailable */
  }
}

// Running from the home screen (standalone) or installed earlier on this device.
export function isInstalled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
    if ((navigator as { standalone?: boolean }).standalone === true) return true;
  } catch {
    /* ignore */
  }
  return readFlag(FLAG_INSTALLED);
}

export type ChangeKey = "familyName" | "country" | "language" | "timezone" | "currency" | "dateOrder" | "weekStart" | "digestEmail" | "digest" | "members" | "childAdd" | "childRemove" | "childRename";
export type Change = { key: ChangeKey; from: string; to: string };

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// Turns the assistant's suggestion into the settings and children to save, plus the list
// of changes shown to the parent before anything is applied. Only fields the suggestion
// sets are touched; the server sanitises the values again.
export function applySuggestion(settings: Settings, children: Child[], s: SettingsSuggestion): { settings: Settings; children: Child[]; changes: Change[] } {
  const next: Settings = { ...settings };
  const changes: Change[] = [];
  const set = <K extends keyof Settings>(key: K, value: Settings[K], label: ChangeKey, from: string, to: string) => {
    if (next[key] === value) return;
    next[key] = value;
    changes.push({ key: label, from, to });
  };
  const p = s.settings;
  if (p.familyName != null && p.familyName.trim()) set("familyName", p.familyName.trim().slice(0, 60), "familyName", settings.familyName, p.familyName.trim().slice(0, 60));
  if (p.country) set("country", p.country.toUpperCase(), "country", settings.country, p.country.toUpperCase());
  if (p.language) set("language", p.language, "language", settings.language, p.language);
  if (p.timezone) set("timezone", p.timezone, "timezone", settings.timezone, p.timezone);
  if (p.currency && /^[A-Za-z]{3}$/.test(p.currency)) set("currency", p.currency.toUpperCase(), "currency", settings.currency, p.currency.toUpperCase());
  if (p.dateOrder) set("dateOrder", p.dateOrder, "dateOrder", settings.dateOrder, p.dateOrder);
  if (p.weekStartsOn) set("weekStart", p.weekStartsOn === "sunday" ? 0 : 1, "weekStart", String(settings.weekStart), p.weekStartsOn === "sunday" ? "0" : "1");
  if (p.digestEmail != null) {
    const e = p.digestEmail.trim().toLowerCase();
    set("digestEmail", e, "digestEmail", settings.digestEmail, e);
    if (e && p.digest == null) set("digest", true, "digest", settings.digest ? "on" : "off", "on");
  }
  if (p.digest != null) set("digest", p.digest && Boolean(next.digestEmail), "digest", settings.digest ? "on" : "off", p.digest && next.digestEmail ? "on" : "off");
  if (p.members) {
    const list = [...new Set(p.members.map((m) => m.trim().slice(0, 20)).filter(Boolean))].slice(0, 6);
    if (list.join("|") !== (settings.members ?? []).join("|")) {
      next.members = list;
      changes.push({ key: "members", from: (settings.members ?? []).join(", "), to: list.join(", ") });
    }
  }

  let kids = [...children];
  for (const name of s.children.remove) {
    const hit = kids.find((c) => sameName(c.name, name));
    if (!hit) continue;
    kids = kids.filter((c) => c.id !== hit.id);
    changes.push({ key: "childRemove", from: hit.name, to: "" });
  }
  for (const r of s.children.rename) {
    const hit = kids.find((c) => sameName(c.name, r.from));
    const to = r.to.trim().slice(0, 40);
    if (!hit || !to || hit.name === to) continue;
    kids = kids.map((c) => (c.id === hit.id ? { ...c, name: to } : c));
    changes.push({ key: "childRename", from: hit.name, to });
  }
  for (const raw of s.children.add) {
    const name = raw.trim().slice(0, 40);
    if (!name || kids.some((c) => sameName(c.name, name)) || kids.length >= MAX_CHILDREN) continue;
    kids.push({ id: `new-${Date.now()}-${kids.length}`, name, color: CHILD_COLORS[kids.length % CHILD_COLORS.length] });
    changes.push({ key: "childAdd", from: "", to: name });
  }
  return { settings: next, children: kids, changes };
}

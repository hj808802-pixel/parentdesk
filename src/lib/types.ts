import type { DateOrder } from "./countries";
import type { ConfidenceLevel, ItemType } from "./schema";

// Shapes shared by the server store and the browser. No Node imports here, so client
// components can import from this file; store.ts re-exports everything.

export type Settings = {
  familyName: string;
  country: string;
  language: string; // result language (schema.ts OUTPUT_LANGUAGES)
  timezone: string;
  dateOrder: DateOrder;
  currency: string;
  weekStart: 0 | 1;
};

export type Child = { id: string; name: string; color: string };

export type SourceKind = "upload" | "paste" | "email" | "sample" | "share" | "gmail";

export type Source = {
  id: string;
  ts: string;
  kind: SourceKind;
  title: string;
  sender: string;
  summary: string;
  language: string;
  pages: number;
  questions: string[];
  // How many separate messages the input held and how many were school-related (mixed
  // input such as a chat export). Absent on records written before v0.2.
  messagesSeen?: number;
  messagesUsed?: number;
};

export type ItemStatus = "open" | "done" | "dismissed";

export type Item = {
  id: string;
  sourceId: string;
  type: ItemType;
  title: string;
  description: string;
  date: string | null;
  end_date: string | null;
  time: string | null;
  end_time: string | null;
  all_day: boolean;
  location: string | null;
  amount: number | null;
  currency: string | null;
  bring: string[];
  requires_action: boolean;
  action_text: string | null;
  confidence: ConfidenceLevel;
  quote: string | null;
  childIds: string[];
  status: ItemStatus;
  createdAt: string;
  updatedAt: string;
};

// Gmail auto-collect (lib/gmail.ts). The refresh token is sealed with lib/crypto.ts and
// never leaves the server; the browser sees GmailView.
export type GmailLink = {
  email: string;
  refreshToken: string; // sealed
  connectedAt: string;
  lastScanAt: string | null;
  lastResult: { scanned: number; picked: number; added: number; skipped: number; error?: string } | null;
  processed: string[]; // Gmail message ids already looked at
  senders: string[]; // addresses that produced items; trusted from then on
  paused: boolean; // set when the token stops working: the parent must reconnect
};
export type GmailView = Omit<GmailLink, "refreshToken" | "processed">;

// Which optional channels this server has switched on.
export type Features = { gmail: boolean; inbound: boolean };

export type FamilyRecord = {
  id: string;
  keyHash: string;
  feedSecret: string;
  inboundCode: string;
  createdAt: string;
  updatedAt: string;
  settings: Settings;
  children: Child[];
  sources: Source[];
  items: Item[];
  usage: Record<string, number>; // "2026-11" -> extractions that month
  gmail?: GmailLink | null;
};

// What the browser sees: no hashes or secrets beyond the read-only feed token.
export type FamilyView = Omit<FamilyRecord, "keyHash" | "feedSecret" | "inboundCode" | "gmail"> & {
  feedToken: string;
  inboundAddress: string | null;
  gmail: GmailView | null;
  features: Features;
};

export const MAX_CHILDREN = 8;

export const CHILD_COLORS = ["#2563eb", "#db2777", "#16a34a", "#ea580c", "#7c3aed", "#0891b2", "#ca8a04", "#dc2626"];

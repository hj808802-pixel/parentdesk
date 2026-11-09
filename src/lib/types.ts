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
  locale: string; // UI language the family uses (i18n LOCALES); the weekly summary is written in it
  digest: boolean; // weekly summary e-mail switched on
  digestEmail: string; // where it goes; empty = not set
  members: string[]; // the adults who share the load ("Mom", "Dad", "Grandma"), for the owner chips
};

export type Child = { id: string; name: string; color: string };

export type SourceKind = "upload" | "paste" | "email" | "sample" | "share" | "gmail" | "room" | "hook";

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
  // Set when the notice arrived through a teacher's class room (lib/rooms.ts).
  roomId?: string;
  postId?: string;
};

export type ItemStatus = "open" | "done" | "dismissed";

export const RECURRENCES = ["daily", "weekly", "biweekly", "monthly"] as const;
export type Recurrence = (typeof RECURRENCES)[number];

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
  roomItemIndex?: number; // for items a class room delivered: the line of the teacher's post, so done/dismissed can be counted back
  recurrence?: Recurrence; // stated rule (PE every Tuesday); ticking it off creates the next occurrence
  owner?: string; // who in the family takes care of it (one of settings.members)
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

// Subscription state mirrored from Stripe webhooks (lib/stripe.ts). Card details never
// reach this server; Stripe keeps them.
export type Plan = "free" | "family";
export type Billing = {
  customerId: string;
  subscriptionId: string | null;
  status: string; // Stripe subscription status: active, trialing, past_due, canceled, ...
  interval: "month" | "year" | null;
  currentPeriodEnd: string | null; // ISO date-time
  cancelAtPeriodEnd: boolean;
  updatedAt: string;
  lastEvent: string | null; // Stripe event id, to ignore replays
};
export type BillingView = Omit<Billing, "customerId" | "subscriptionId" | "lastEvent">;

// A partner invite link: the family keeps a hash of the token, the link carries the token.
export type Invite = { hash: string; createdAt: string; expiresAt: string; uses: number; maxUses: number };

// A class room this family follows (lib/rooms.ts). The teacher's posts land on the list
// tagged with these children. Only the room's id and name are kept here.
export type RoomSubscription = { roomId: string; name: string; teacherName: string; school?: string; childIds: string[]; joinedAt: string; lastPostId: string | null };

// Weekly summary e-mail state.
export type DigestState = { lastSentAt: string | null; lastWeeklyAt: string | null; lastError: string | null };

// Which optional channels this server has switched on.
export type Features = { gmail: boolean; inbound: boolean; billing: boolean; digest: boolean };

// What the free plan allows while billing is on. Mirrored to the browser so the pricing
// page and the settings can say the numbers.
export type PlanLimits = { freeNotices: number; freeChildren: number; priceMonthly: string; priceYearly: string };

export type FamilyRecord = {
  id: string;
  keyHash: string;
  memberHashes?: string[]; // keys handed to partners through invite links (hashes)
  feedSecret: string;
  hookSecret: string; // the device-automation address (/api/hook/<id>_<secret>) carries it
  inboundCode: string;
  createdAt: string;
  updatedAt: string;
  settings: Settings;
  children: Child[];
  sources: Source[];
  items: Item[];
  usage: Record<string, number>; // "2026-11" -> extractions that month
  gmail?: GmailLink | null;
  billing?: Billing | null;
  invites?: Invite[];
  digest?: DigestState | null;
  counters?: Record<string, number>; // "ask", "reply", "gmail_scan", "digest" -> lifetime counts (ops only)
  rooms?: RoomSubscription[];
};

// What the browser sees: no hashes or secrets beyond the read-only feed token.
export type FamilyView = Omit<FamilyRecord, "keyHash" | "memberHashes" | "feedSecret" | "hookSecret" | "inboundCode" | "gmail" | "billing" | "invites" | "counters"> & {
  feedToken: string;
  hookToken: string;
  inboundAddress: string | null;
  gmail: GmailView | null;
  features: Features;
  plan: Plan;
  billing: BillingView | null;
  limits: PlanLimits;
  invites: number; // live invite links
};

export const MAX_CHILDREN = 8;

export const CHILD_COLORS = ["#2563eb", "#db2777", "#16a34a", "#ea580c", "#7c3aed", "#0891b2", "#ca8a04", "#dc2626"];

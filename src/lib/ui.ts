import type { ItemType } from "./schema";

// Shared look-and-feel tokens for item types and children (client and server safe).

export const TYPE_STYLES: Record<ItemType, { badge: string; dot: string }> = {
  event: { badge: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-200", dot: "bg-indigo-500" },
  deadline: { badge: "bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-200", dot: "bg-amber-500" },
  todo: { badge: "bg-sky-100 text-sky-900 dark:bg-sky-900/50 dark:text-sky-200", dot: "bg-sky-500" },
  payment: { badge: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-200", dot: "bg-emerald-500" },
  consent: { badge: "bg-rose-100 text-rose-900 dark:bg-rose-900/50 dark:text-rose-200", dot: "bg-rose-500" },
  info: { badge: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300", dot: "bg-zinc-400" },
};

export const BTN = "inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-semibold transition disabled:opacity-50";
export const BTN_PRIMARY = `${BTN} bg-indigo-600 text-white hover:bg-indigo-500`;
export const BTN_SECONDARY = `${BTN} border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800`;
export const BTN_SMALL = "rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800";
export const INPUT = "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
export const CARD = "rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900";

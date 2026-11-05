import type { Item } from "./types";

// Catches the same item arriving twice: the newsletter photographed again, the trip that
// was in last week's e-mail and today's chat message, a Gmail scan overlapping a manual
// upload. Two items are the same when they fall on the same date and their titles say
// the same thing. Titles in Chinese, Japanese or Korean are compared by character
// bigrams (no word spaces to rely on); others by words.

const CJK = /[぀-ヿ㐀-䶿一-鿿가-힯]/;

export function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function grams(s: string): Set<string> {
  const n = normalizeTitle(s);
  if (CJK.test(n)) {
    const c = n.replace(/\s+/g, "");
    const out = new Set<string>();
    if (c.length === 1) out.add(c);
    for (let i = 0; i < c.length - 1; i++) out.add(c.slice(i, i + 2));
    return out;
  }
  return new Set(n.split(" ").filter((w) => w.length >= 2));
}

// Jaccard similarity of the two titles, 0..1.
export function titleSimilarity(a: string, b: string): number {
  const A = grams(a);
  const B = grams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}

export type DupCandidate = Pick<Item, "title" | "date" | "type" | "amount" | "quote">;

export function isDuplicate(c: DupCandidate, e: DupCandidate): boolean {
  if ((c.date ?? null) !== (e.date ?? null)) return false;
  if (c.quote && e.quote && c.type === e.type && normalizeTitle(c.quote) === normalizeTitle(e.quote)) return true;
  if (titleSimilarity(c.title, e.title) >= 0.5) return true;
  if (c.type === "payment" && e.type === "payment" && c.amount != null && c.amount === e.amount) return true;
  const na = normalizeTitle(c.title);
  const nb = normalizeTitle(e.title);
  if (na.length >= 6 && nb.length >= 6 && (na.includes(nb) || nb.includes(na))) return true;
  return false;
}

export function findDuplicate<T extends DupCandidate>(c: DupCandidate, existing: T[]): T | null {
  for (const e of existing) if (isDuplicate(c, e)) return e;
  return null;
}

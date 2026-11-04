import { buildFeed, type FeedItem, type FeedLabels } from "@/lib/ics";
import { getDict, isLocale } from "@/lib/i18n";
import { loadFamily, parseFeedToken, verifyFeedSecret } from "@/lib/store";

export const runtime = "nodejs";

// The read-only calendar feed that Google, Apple and Outlook calendars subscribe to:
// /api/calendar/<familyId>_<feedSecret>.ics. Open items with a date become events with
// reminders. Done and dismissed items disappear from the feed on the next refresh.

export async function GET(_req: Request, { params }: { params: Promise<{ feed: string }> }) {
  const { feed } = await params;
  const parsed = parseFeedToken(feed);
  if (!parsed) return new Response("not found", { status: 404 });
  const rec = await loadFamily(parsed.id);
  if (!rec || !verifyFeedSecret(rec, parsed.secret)) return new Response("not found", { status: 404 });

  const t = getDict(isLocale(rec.settings.language) ? rec.settings.language : "en");
  const labels: FeedLabels = {
    deadline: t.item.types.deadline,
    todo: t.item.types.todo,
    payment: t.item.types.payment,
    consent: t.item.types.consent,
    bring: t.item.bring,
  };
  const childName = new Map(rec.children.map((c) => [c.id, c.name]));
  const items: FeedItem[] = rec.items
    .filter((it) => it.status === "open" && it.date)
    .map((it) => ({
      id: it.id,
      type: it.type,
      title: it.title,
      description: it.description,
      date: it.date,
      end_date: it.end_date,
      time: it.time,
      end_time: it.end_time,
      all_day: it.all_day,
      location: it.location,
      bring: it.bring,
      action_text: it.action_text,
      childNames: it.childIds.map((id) => childName.get(id)).filter((n): n is string => Boolean(n)),
      updatedAt: it.updatedAt,
    }));
  const name = rec.settings.familyName ? `${rec.settings.familyName} · ParentDesk` : "ParentDesk";
  return new Response(buildFeed(name, items, labels), {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'inline; filename="parentdesk.ics"',
      "cache-control": "private, max-age=300",
    },
  });
}

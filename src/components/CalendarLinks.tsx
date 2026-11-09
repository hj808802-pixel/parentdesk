"use client";

import { useEffect, useState } from "react";
import { feedUrl } from "@/lib/client";
import { useI18n } from "@/lib/i18n/context";
import { FLAG_CALENDAR, calendarLinks, platformOf, readFlag, writeFlag, type Platform } from "@/lib/setup";
import { BTN_PRIMARY, BTN_SECONDARY } from "@/lib/ui";

// One tap per calendar app. The phone's own app comes first; a short note under the
// tapped button says what the calendar app will ask next.

type App = "google" | "apple" | "outlook";

export default function CalendarLinks({ feedToken, name, onLinked }: { feedToken: string; name: string; onLinked?: () => void }) {
  const { t } = useI18n();
  const [platform, setPlatform] = useState<Platform>("other");
  const [tapped, setTapped] = useState<App | null>(null);
  const [linked, setLinked] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading the device once
    setPlatform(platformOf(navigator.userAgent, navigator.maxTouchPoints));
    setLinked(readFlag(FLAG_CALENDAR));
  }, []);

  const links = calendarLinks(feedUrl(feedToken), name);
  const order: App[] = platform === "apple" ? ["apple", "google", "outlook"] : platform === "android" ? ["google", "outlook", "apple"] : ["google", "apple", "outlook"];
  const labels: Record<App, string> = { google: t.settings.setup.calGoogle, apple: t.settings.setup.calApple, outlook: t.settings.setup.calOutlook };
  const notes: Record<App, string> = { google: t.settings.setup.calNoteGoogle, apple: t.settings.setup.calNoteApple, outlook: t.settings.setup.calNoteOutlook };

  function mark() {
    writeFlag(FLAG_CALENDAR);
    setLinked(true);
    onLinked?.();
  }

  return (
    <div>
      <div className="mt-3 grid gap-2">
        {order.map((app, i) => (
          <a
            key={app}
            href={links[app]}
            target={app === "apple" ? undefined : "_blank"}
            rel="noopener"
            className={`${i === 0 ? BTN_PRIMARY : BTN_SECONDARY} w-full`}
            onClick={() => {
              setTapped(app);
              mark();
            }}
          >
            {labels[app]}
          </a>
        ))}
      </div>
      {tapped && (
        <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400" role="status">
          {notes[tapped]}
        </p>
      )}
      {linked && <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-300">{t.settings.setup.stepCalendarDone}</p>}
    </div>
  );
}

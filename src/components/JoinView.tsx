"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, ApiFailure, browserTimezone, rememberKey, type RoomInfoResponse } from "@/lib/client";
import { useFamily } from "@/lib/family-context";
import { useI18n } from "@/lib/i18n/context";
import { fmt } from "@/lib/i18n";
import { localePath } from "@/lib/i18n/locales";
import { BTN_PRIMARY, BTN_SECONDARY, CARD } from "@/lib/ui";
import ChildChips from "./ChildChips";

// /join?i=<family id>.<secret>: the page a partner's invite link opens. One request, then
// a link into the family's week.
// /join?r=<room id>.<secret>: a teacher's room link. Shows the room, lets the parent pick
// the children in that class, then follows it (creating the family when there is none).

export default function JoinView() {
  const params = useSearchParams();
  // Read once: both flows drop the token from the URL when they are done, and the page
  // must keep showing the outcome rather than switch to the other flow.
  const [tokens] = useState(() => ({ room: params.get("r"), invite: params.get("i") }));
  if (tokens.room) return <RoomJoin token={tokens.room} />;
  return <InviteJoin token={tokens.invite} />;
}

function InviteJoin({ token }: { token: string | null }) {
  const { locale, t } = useI18n();
  const { setFamily } = useFamily();
  const [state, setState] = useState<"working" | "done" | "invalid">("working");
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!token) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reading the URL once
      setState("invalid");
      return;
    }
    api
      .joinInvite(token)
      .then((res) => {
        rememberKey(res.key);
        setFamily(res.family);
        setState("done");
        window.history.replaceState(null, "", window.location.pathname);
      })
      .catch(() => setState("invalid"));
  }, [token, setFamily]);

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-12">
      <section className={`${CARD} text-center`}>
        <h1 className="text-xl font-bold">{t.join.title}</h1>
        {state === "working" && <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">{t.join.working}</p>}
        {state === "done" && (
          <>
            <p className="mt-3 text-sm">{t.join.done}</p>
            <Link href={localePath(locale, "/")} className={`${BTN_PRIMARY} mt-5`}>
              {t.join.goWeek}
            </Link>
          </>
        )}
        {state === "invalid" && (
          <>
            <p className="mt-3 text-sm text-zinc-700 dark:text-zinc-300">{t.join.invalid}</p>
            <Link href={localePath(locale, "/settings")} className={`${BTN_SECONDARY} mt-5`}>
              {t.join.openSettings}
            </Link>
          </>
        )}
      </section>
    </main>
  );
}

function RoomJoin({ token }: { token: string }) {
  const { locale, t } = useI18n();
  const { family, loading, setFamily } = useFamily();
  const [info, setInfo] = useState<RoomInfoResponse | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "joining" | "done" | "invalid" | "full">("loading");
  const [selected, setSelected] = useState<string[]>([]);
  const [backfilled, setBackfilled] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    if (started.current || loading) return;
    started.current = true;
    api
      .roomInfo(token)
      .then((res) => {
        setInfo(res);
        setSelected(res.childIds);
        setState("ready");
      })
      .catch(() => setState("invalid"));
  }, [token, loading]);

  async function follow() {
    setState("joining");
    try {
      const res = await api.roomJoin(token, selected, { locale, timezone: browserTimezone() });
      rememberKey(res.key);
      setFamily(res.family);
      setBackfilled(res.backfilled.items);
      setState("done");
      window.history.replaceState(null, "", window.location.pathname);
    } catch (e) {
      setState(e instanceof ApiFailure && (e.code === "room_full" || e.code === "too_many_rooms") ? "full" : "invalid");
    }
  }

  const toggle = (id: string) => setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const room = info?.room;
  const roomLabel = room ? (room.school ? `${room.school} · ${room.name}` : room.name) : "";

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-12">
      <section className={CARD}>
        <h1 className="text-xl font-bold">{t.join.roomTitle}</h1>
        {state === "loading" && <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">{t.common.loading}</p>}
        {(state === "invalid" || state === "full") && (
          <>
            <p className="mt-3 text-sm text-zinc-700 dark:text-zinc-300">{state === "full" ? t.join.roomFull : t.join.roomInvalid}</p>
            <Link href={localePath(locale, "/")} className={`${BTN_SECONDARY} mt-5`}>
              {t.join.goWeek}
            </Link>
          </>
        )}
        {room && state === "done" && (
          <>
            <p dir="auto" className="mt-3 text-sm">{fmt(t.join.roomDone, { room: roomLabel })}</p>
            {backfilled > 0 && <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{fmt(t.join.roomBackfilled, { items: backfilled })}</p>}
            <div className="mt-5 flex flex-wrap gap-2">
              <Link href={localePath(locale, "/")} className={BTN_PRIMARY}>
                {t.join.goWeek}
              </Link>
              <Link href={localePath(locale, "/settings")} className={BTN_SECONDARY}>
                {t.join.openSettings}
              </Link>
            </div>
          </>
        )}
        {room && (state === "ready" || state === "joining") && (
          <>
            <p dir="auto" className="mt-3 text-sm">
              {fmt(room.teacherName ? t.join.roomLead : t.join.roomLeadNoTeacher, { teacher: room.teacherName, room: roomLabel })}
            </p>
            <p className="mt-1 text-xs text-zinc-500">{fmt(t.join.roomFollowers, { n: room.memberCount })}</p>
            {info?.following && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">{t.join.roomAlready}</p>}
            {family && family.children.length > 0 && (
              <fieldset className="mt-4">
                <legend className="text-sm font-medium">{t.join.roomChildren}</legend>
                <div className="mt-2">
                  <ChildChips childrenList={family.children} selected={selected} onToggle={toggle} />
                </div>
              </fieldset>
            )}
            {family && family.children.length === 0 && <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">{t.join.roomChildrenHint}</p>}
            {!family && <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">{t.join.roomNoFamily}</p>}
            <button type="button" className={`${BTN_PRIMARY} mt-5`} disabled={state === "joining"} onClick={follow}>
              {state === "joining" ? t.join.roomJoining : info?.following ? t.join.roomUpdate : t.join.roomJoin}
            </button>
          </>
        )}
      </section>
    </main>
  );
}

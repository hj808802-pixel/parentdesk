"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, ApiFailure, browserTimezone, rememberKey, type RoomInfoResponse } from "@/lib/client";
import { useFamily } from "@/lib/family-context";
import { useI18n } from "@/lib/i18n/context";
import { fmt } from "@/lib/i18n";
import { localePath } from "@/lib/i18n/locales";
import type { DirectoryHit } from "@/lib/rooms";
import { roomLine } from "@/lib/rooms-ui";
import { BTN_PRIMARY, BTN_SECONDARY, CARD, INPUT } from "@/lib/ui";
import ChildChips from "./ChildChips";

// /join?i=<family id>.<secret>: the page a partner's invite link opens. One request, then
// a link into the family's week.
// /join?r=<room id>.<secret>: a teacher's room link. Shows the room, lets the parent pick
// the children in that class, then follows it (creating the family when there is none).
// /join with nothing: "find your class". Search the school, pick the class, type the
// class code the teacher handed out, follow.

export default function JoinView() {
  const params = useSearchParams();
  // Read once: the flows drop the token from the URL when they are done, and the page must
  // keep showing the outcome rather than switch to another flow.
  const [tokens] = useState(() => ({ room: params.get("r"), invite: params.get("i") }));
  if (tokens.room)
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-12">
        <RoomJoin token={tokens.room} />
      </main>
    );
  if (tokens.invite) return <InviteJoin token={tokens.invite} />;
  return <RoomFinder />;
}

function InviteJoin({ token }: { token: string }) {
  const { locale, t } = useI18n();
  const { setFamily } = useFamily();
  const [state, setState] = useState<"working" | "done" | "invalid">("working");
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
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
            <Link href={localePath(locale, "/week")} className={`${BTN_PRIMARY} mt-5`}>
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

// The directory: search by school name (and class words), pick a result, then join with
// the class code. A link or QR from the teacher skips the code.
function RoomFinder() {
  const { t } = useI18n();
  const { family } = useFamily();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<DirectoryHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<DirectoryHit | null>(null);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    const query = q.trim();
    if (query.length < 2 || busy) return;
    setBusy(true);
    setError(null);
    setPicked(null);
    try {
      const res = await api.roomSearch(query, family?.settings.country);
      setHits(res.rooms);
    } catch (err) {
      const code = err instanceof ApiFailure ? err.code : "generic";
      const dict = t.add.errors as Record<string, string>;
      setError(code in dict && code !== "generic" ? dict[code] : t.join.findError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-12">
      <section className={CARD}>
        <h1 className="text-xl font-bold">{t.join.findTitle}</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{t.join.findLead}</p>
        <form onSubmit={search} className="mt-4 flex gap-2">
          <input className={`${INPUT} min-w-0`} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.join.findPlaceholder} maxLength={80} aria-label={t.join.findTitle} enterKeyHint="search" />
          <button type="submit" className={`${BTN_PRIMARY} shrink-0 whitespace-nowrap`} disabled={busy || q.trim().length < 2}>
            {busy ? t.common.loading : t.join.findButton}
          </button>
        </form>
        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
        {hits && hits.length === 0 && <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">{t.join.findNone}</p>}
        {hits && hits.length > 0 && (
          <ul className="mt-3 grid gap-2" aria-live="polite">
            {hits.map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  aria-pressed={picked?.id === h.id}
                  onClick={() => setPicked(h)}
                  className={`w-full rounded-xl border px-3 py-2 text-left text-sm ${picked?.id === h.id ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40" : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"}`}
                >
                  <span dir="auto" className="block font-medium">
                    {roomLine(t, h)}
                  </span>
                  <span dir="auto" className="block text-xs text-zinc-500">
                    {[h.teacherName, fmt(t.join.roomFollowers, { n: h.members })].filter(Boolean).join(" · ")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-xs text-zinc-500">{t.join.findHint}</p>
      </section>
      {picked && (
        <div className="mt-4">
          <RoomJoin key={picked.id} roomId={picked.id} />
        </div>
      )}
    </main>
  );
}

// One room: by invite token (no code) or by id from the directory (code required).
function RoomJoin({ token, roomId }: { token?: string; roomId?: string }) {
  const { locale, t } = useI18n();
  const { family, loading, setFamily } = useFamily();
  const [info, setInfo] = useState<RoomInfoResponse | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "joining" | "done" | "invalid" | "full">("loading");
  const [selected, setSelected] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [codeWrong, setCodeWrong] = useState(false);
  const [backfilled, setBackfilled] = useState(0);
  const started = useRef(false);
  const byCode = !token;

  useEffect(() => {
    if (started.current || loading) return;
    started.current = true;
    (token ? api.roomInfo(token) : api.roomInfoById(roomId ?? ""))
      .then((res) => {
        setInfo(res);
        setSelected(res.childIds);
        setState("ready");
      })
      .catch(() => setState("invalid"));
  }, [token, roomId, loading]);

  async function follow() {
    setState("joining");
    setCodeWrong(false);
    try {
      const init = { locale, timezone: browserTimezone() };
      const res = token ? await api.roomJoin(token, selected, init) : await api.roomJoinByCode(roomId ?? "", code, selected, init);
      rememberKey(res.key);
      setFamily(res.family);
      setBackfilled(res.backfilled.items);
      setState("done");
      if (token) window.history.replaceState(null, "", window.location.pathname);
    } catch (e) {
      if (e instanceof ApiFailure && e.code === "bad_code") {
        setCodeWrong(true);
        setState("ready");
        return;
      }
      setState(e instanceof ApiFailure && (e.code === "room_full" || e.code === "too_many_rooms") ? "full" : "invalid");
    }
  }

  const toggle = (id: string) => setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const room = info?.room;
  const roomLabel = room ? roomLine(t, room) : "";
  const canJoin = state === "ready" && (!byCode || code.replace(/[^a-z0-9]/gi, "").length >= 6);

  return (
    <section className={CARD}>
      <h2 className="text-xl font-bold">{t.join.roomTitle}</h2>
      {state === "loading" && <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">{t.common.loading}</p>}
      {(state === "invalid" || state === "full") && (
        <>
          <p className="mt-3 text-sm text-zinc-700 dark:text-zinc-300">{state === "full" ? t.join.roomFull : t.join.roomInvalid}</p>
          <Link href={localePath(locale, "/week")} className={`${BTN_SECONDARY} mt-5`}>
            {t.join.goWeek}
          </Link>
        </>
      )}
      {room && state === "done" && (
        <>
          <p dir="auto" className="mt-3 text-sm">{fmt(t.join.roomDone, { room: roomLabel })}</p>
          {backfilled > 0 && <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{fmt(t.join.roomBackfilled, { items: backfilled })}</p>}
          <div className="mt-5 flex flex-wrap gap-2">
            <Link href={localePath(locale, "/week")} className={BTN_PRIMARY}>
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
          {room.description && <p dir="auto" className="mt-3 rounded-lg bg-zinc-50 px-3 py-2 text-sm text-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300">{room.description}</p>}
          {info?.following && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">{t.join.roomAlready}</p>}
          {byCode && (
            <label className="mt-4 grid gap-1 text-sm">
              <span className="font-medium">{t.join.code}</span>
              <input
                className={`${INPUT} max-w-xs font-mono text-lg uppercase tracking-[0.3em]`}
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.toUpperCase());
                  setCodeWrong(false);
                }}
                placeholder={t.join.codePlaceholder}
                maxLength={8}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                inputMode="text"
              />
              {codeWrong && <span className="text-xs text-red-600 dark:text-red-400">{t.join.codeWrong}</span>}
            </label>
          )}
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
          <button type="button" className={`${BTN_PRIMARY} mt-5`} disabled={!canJoin} onClick={follow}>
            {state === "joining" ? t.join.roomJoining : info?.following ? t.join.roomUpdate : t.join.roomJoin}
          </button>
        </>
      )}
    </section>
  );
}

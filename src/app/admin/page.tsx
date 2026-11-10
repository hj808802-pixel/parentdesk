"use client";

import { useCallback, useEffect, useState } from "react";
import type { Stats } from "@/lib/admin";
import type { RoomStats } from "@/lib/rooms";
import type { Run } from "@/lib/ops";
import { BTN_PRIMARY, BTN_SECONDARY, BTN_SMALL, CARD, INPUT } from "@/lib/ui";

// /admin: sign in with ADMIN_TOKEN, then the numbers from /api/admin/stats.

type Payload = {
  stats: Stats;
  rooms?: RoomStats;
  search?: { listedRooms: number; directoryEntries: number; schools: number };
  runs: Record<string, Run[]>;
  server: { storage: string; features: Record<string, boolean>; extractModel: string; assistModel: string; classifyModel: string; dailyCap: number };
  ms: number;
};
type FamilyInfo = Record<string, unknown>;

async function getJson<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T | null }> {
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const body = (await res.json().catch(() => null)) as T | null;
  return { status: res.status, body };
}

function Kpi({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className={CARD}>
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
      {sub && <p className="text-xs text-zinc-500">{sub}</p>}
    </div>
  );
}

function Table({ title, rows }: { title: string; rows: [string, number | string][] }) {
  return (
    <div className={CARD}>
      <h3 className="text-sm font-semibold">{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-2 text-xs text-zinc-500">none</p>
      ) : (
        <table className="mt-2 w-full text-sm">
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k} className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="py-1 pr-2">{k}</td>
                <td className="py-1 text-right tabular-nums">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function AdminPage() {
  const [token, setToken] = useState("");
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [off, setOff] = useState(false);
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [lookup, setLookup] = useState("");
  const [family, setFamily] = useState<FamilyInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [rebuild, setRebuild] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const r = await getJson<Payload & { ok: boolean; error?: string }>("/api/admin/stats");
    setLoading(false);
    if (r.status === 404) {
      setOff(true);
      setAuthed(false);
      return;
    }
    if (r.status === 401) {
      setAuthed(false);
      return;
    }
    if (!r.body?.ok) {
      setError(r.body?.error ?? `HTTP ${r.status}`);
      return;
    }
    setAuthed(true);
    setData(r.body);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from the server
    void load();
  }, [load]);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const r = await getJson<{ ok: boolean; error?: string }>("/api/admin/login", { method: "POST", body: JSON.stringify({ token }) });
    if (!r.body?.ok) {
      setError(r.body?.error ?? `HTTP ${r.status}`);
      return;
    }
    setToken("");
    await load();
  }

  async function logout() {
    await fetch("/api/admin/login", { method: "DELETE" });
    setAuthed(false);
    setData(null);
  }

  async function rebuildSearch() {
    setRebuild("Rebuilding…");
    const r = await getJson<{ ok: boolean; listed?: number; schools?: number; ms?: number; error?: string }>("/api/admin/rebuild", { method: "POST" });
    setRebuild(r.body?.ok ? `Rebuilt: ${r.body.listed} listed rooms, ${r.body.schools} schools (${r.body.ms} ms)` : (r.body?.error ?? `HTTP ${r.status}`));
    if (r.body?.ok) await load();
  }

  async function find(e: React.FormEvent) {
    e.preventDefault();
    setFamily(null);
    const r = await getJson<{ ok: boolean; family?: FamilyInfo; error?: string }>(`/api/admin/stats?family=${encodeURIComponent(lookup.trim())}`);
    setFamily(r.body?.family ?? { error: r.body?.error ?? `HTTP ${r.status}` });
  }

  if (authed === null) return <p className="p-8 text-sm text-zinc-500">Loading…</p>;

  if (!authed) {
    return (
      <main className="mx-auto w-full max-w-sm px-4 py-16">
        <h1 className="text-xl font-bold">ParentDesk admin</h1>
        {off ? (
          <p className="mt-3 text-sm text-zinc-600">The console is off: set ADMIN_TOKEN on the server.</p>
        ) : (
          <form onSubmit={login} className="mt-4 grid gap-3">
            <input className={INPUT} type="password" placeholder="ADMIN_TOKEN" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
            <button type="submit" className={BTN_PRIMARY} disabled={!token.trim()}>
              Sign in
            </button>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </form>
        )}
      </main>
    );
  }

  const s = data?.stats;
  const maxDay = Math.max(1, ...(s?.notices.byDay.map((d) => d.n) ?? [1]));
  const obj = (m: Record<string, number>): [string, number][] => Object.entries(m).sort((a, b) => b[1] - a[1]);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">ParentDesk admin</h1>
        <div className="flex gap-2">
          <button type="button" className={BTN_SECONDARY} onClick={load} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <button type="button" className={BTN_SMALL} onClick={logout}>
            Sign out
          </button>
        </div>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {s && data && (
        <>
          <p className="mt-2 text-xs text-zinc-500">
            {s.generatedAt} · computed in {data.ms} ms · storage {data.server.storage} · models {data.server.extractModel} / {data.server.assistModel} / {data.server.classifyModel} · daily cap {data.server.dailyCap}
            {s.families.truncated && " · TRUNCATED: more families than the console walks"}
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            features:{" "}
            {Object.entries(data.server.features)
              .map(([k, v]) => `${k} ${v ? "on" : "off"}`)
              .join(" · ")}
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <Kpi label="Families" value={s.families.total} sub={`+${s.families.created7d} this week · +${s.families.created30d} this month`} />
            <Kpi label="Active (7d)" value={s.families.active7d} sub={`${s.families.withItems} with items · ${s.families.withChildren} with children`} />
            <Kpi label="Notices this month" value={s.notices.thisMonth} sub={`${s.sources.last7d} in the last 7 days`} />
            <Kpi label="Items" value={s.items.total} sub={`${s.items.open} open · ${s.items.done} done · ${s.items.needsCheck} need a check`} />
            <Kpi label="Children" value={s.children} />
            <Kpi label="Plans" value={`${s.plans.family} / ${s.plans.free}`} sub="family / free" />
            <Kpi label="Gmail" value={s.gmail.connected} sub={`${s.gmail.paused} paused`} />
            <Kpi label="Weekly summary on" value={s.digest.on} sub={`${s.invites.live} live invite links`} />
            {data.rooms && (
              <Kpi label="Class rooms" value={`${data.rooms.rooms} / ${data.rooms.teachers}`} sub={`rooms / teachers · ${data.rooms.members} following · ${data.rooms.posts} posts (${data.rooms.posts7d} this week) · ${data.rooms.delivered} deliveries`} />
            )}
            {data.search && (
              <Kpi
                label="Class search"
                value={`${data.search.listedRooms} / ${data.search.schools}`}
                sub={`listed rooms / schools · directory holds ${data.search.directoryEntries}${data.search.directoryEntries !== data.search.listedRooms ? " (OUT OF STEP: rebuild)" : ""} · ${s.following} families follow a room`}
              />
            )}
            <Kpi label="Notifications on" value={s.push.devices} sub={`devices · ${s.push.families} families`} />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" className={BTN_SMALL} onClick={rebuildSearch}>
              Rebuild class search
            </button>
            {rebuild && <span className="text-xs text-zinc-500">{rebuild}</span>}
          </div>

          <section className={`${CARD} mt-4`}>
            <h3 className="text-sm font-semibold">Notices per day (14 days)</h3>
            <div className="mt-3 flex h-24 items-end gap-1">
              {s.notices.byDay.map((d) => (
                <div key={d.day} className="flex flex-1 flex-col items-center gap-1" title={`${d.day}: ${d.n}`}>
                  <div className="w-full rounded-t bg-indigo-500" style={{ height: `${Math.max(2, (d.n / maxDay) * 80)}px` }} />
                  <span className="text-[9px] text-zinc-500">{d.day.slice(8)}</span>
                </div>
              ))}
            </div>
          </section>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Table title="Items by type" rows={obj(s.items.byType)} />
            <Table title="Notices by channel" rows={obj(s.sources.byKind)} />
            <Table title="Countries" rows={s.top.countries} />
            <Table title="Result languages" rows={s.top.languages} />
            <Table title="UI languages" rows={s.top.locales} />
            <Table title="Subscription statuses" rows={obj(s.plans.statuses)} />
            <Table title="Lifetime counters" rows={obj(s.counters)} />
          </div>

          <section className={`${CARD} mt-4`}>
            <h3 className="text-sm font-semibold">Scheduled runs</h3>
            {Object.keys(data.runs).length === 0 && <p className="mt-2 text-xs text-zinc-500">No runs recorded yet.</p>}
            {Object.entries(data.runs).map(([name, runs]) => (
              <div key={name} className="mt-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{name}</p>
                <ul className="mt-1 grid gap-1 text-xs">
                  {runs.slice(0, 5).map((r) => (
                    <li key={r.at} className="font-mono">
                      {r.at} · {r.ms} ms · {JSON.stringify(r.summary)}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>

          <section className={`${CARD} mt-4`}>
            <h3 className="text-sm font-semibold">Family lookup</h3>
            <form onSubmit={find} className="mt-2 flex gap-2">
              <input className={INPUT} placeholder="family id (12 hex)" value={lookup} onChange={(e) => setLookup(e.target.value)} />
              <button type="submit" className={BTN_SECONDARY} disabled={!/^[0-9a-f]{12}$/.test(lookup.trim())}>
                Find
              </button>
            </form>
            {family && <pre className="mt-3 overflow-auto rounded-lg bg-zinc-100 p-3 text-xs dark:bg-zinc-800">{JSON.stringify(family, null, 2)}</pre>}
          </section>
        </>
      )}
    </main>
  );
}

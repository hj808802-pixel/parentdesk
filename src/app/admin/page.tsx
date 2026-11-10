"use client";

import { useCallback, useEffect, useState } from "react";
import type { FamilyRow, Stats } from "@/lib/admin";
import type { RoomStats } from "@/lib/rooms";
import type { AdminAction, Run } from "@/lib/ops";
import { BTN_PRIMARY, BTN_SECONDARY, BTN_SMALL, CARD, INPUT } from "@/lib/ui";

// /admin: the operator's console (Korean, for the operator). Sign in with ADMIN_TOKEN.
// Tabs: overview (numbers), families, teachers and rooms, schools, system. Tables carry
// counts and settings only; actions (delete, unlist, clean up) are confirmed and logged.

type Payload = {
  stats: Stats;
  rooms?: RoomStats;
  search?: { listedRooms: number; directoryEntries: number; schools: number };
  runs: Record<string, Run[]>;
  server: { storage: string; features: Record<string, boolean>; extractModel: string; assistModel: string; classifyModel: string; dailyCap: number };
  ms: number;
};
type TeacherRow = { id: string; name: string; school: string; region: string; city: string; country: string; rooms: number; monthPosts: number; createdAt: string };
type RoomRow = { id: string; teacherId: string; teacherName: string; school: string; grade: string; classLabel: string; name: string; members: number; posts: number; drafts: number; lastPostAt: string | null; listed: boolean; createdAt: string; orphan: boolean };
type SchoolRow = { id: string; name: string; region: string; city: string; country: string; rooms: number; teachers: number };
type Lists = { families: FamilyRow[]; teachers: TeacherRow[]; rooms: RoomRow[]; schools: SchoolRow[]; log: AdminAction[]; checklist: { key: string; on: boolean }[]; abandoned: string[] };
type FamilyInfo = Record<string, unknown>;
type Tab = "overview" | "families" | "rooms" | "schools" | "system";

const TABS: [Tab, string][] = [
  ["overview", "개요"],
  ["families", "가족"],
  ["rooms", "선생님·알림방"],
  ["schools", "학교"],
  ["system", "시스템"],
];

const CHECK: Record<string, [string, string]> = {
  model: ["AI 모델 키", "안내문 읽기에 필요합니다. 없으면 데모 결과만 나옵니다."],
  storage: ["저장소", "가족·알림방 문서를 보관하는 곳입니다."],
  admin: ["관리자 콘솔", "이 화면입니다."],
  cron: ["예약 작업", "Gmail 매일 확인과 주간 요약 발송에 필요합니다."],
  gmail: ["Gmail 자동 수집", "Google 앱 검증 전에는 Testing 모드(7일 토큰)입니다."],
  push: ["푸시 알림", "선생님이 올리면 학부모 기기로 알림이 갑니다."],
  billing: ["결제(Stripe)", "꺼져 있으면 모든 가족이 가족 요금제를 무료로 씁니다. Stripe 계정과 가격 ID가 필요합니다."],
  digest: ["주간 요약 메일(Resend)", "도메인과 Resend 키가 필요합니다."],
  inbound: ["메일 전달 주소", "도메인이 필요합니다."],
};

const ACTION_KO: Record<string, string> = {
  family_delete: "가족 삭제",
  family_reset_usage: "이번 달 사용량 초기화",
  families_purge: "빈 가족 정리",
  room_unlist: "검색에서 내림",
  room_delete: "알림방 삭제",
  teacher_delete: "선생님 데스크 삭제",
};

async function getJson<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T | null }> {
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const body = (await res.json().catch(() => null)) as T | null;
  return { status: res.status, body };
}

const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "-");
const TH = "px-2 py-2 text-left text-xs font-semibold text-zinc-500 whitespace-nowrap";
const TD = "px-2 py-2 text-sm whitespace-nowrap";
const DANGER = `${BTN_SMALL} text-red-600 dark:text-red-400`;

function Kpi({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className={CARD}>
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
      {sub && <p className="text-xs text-zinc-500">{sub}</p>}
    </div>
  );
}

function Pairs({ title, rows }: { title: string; rows: [string, number | string][] }) {
  return (
    <div className={CARD}>
      <h3 className="text-sm font-semibold">{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-2 text-xs text-zinc-500">없음</p>
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
  const [lists, setLists] = useState<Lists | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  const [filter, setFilter] = useState("");
  const [family, setFamily] = useState<FamilyInfo | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const r = await getJson<Payload & { ok: boolean; error?: string }>("/api/admin/stats");
    if (r.status === 404 || r.status === 401) {
      setLoading(false);
      setOff(r.status === 404);
      setAuthed(false);
      return;
    }
    if (!r.body?.ok) {
      setLoading(false);
      setError(r.body?.error ?? `HTTP ${r.status}`);
      return;
    }
    setAuthed(true);
    setData(r.body);
    const l = await getJson<Lists & { ok: boolean }>("/api/admin/list");
    if (l.body?.ok) setLists(l.body);
    setLoading(false);
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
      setError(r.body?.error === "bad_token" ? "토큰이 맞지 않습니다." : (r.body?.error ?? `HTTP ${r.status}`));
      return;
    }
    setToken("");
    await load();
  }

  async function logout() {
    await fetch("/api/admin/login", { method: "DELETE" });
    setAuthed(false);
    setData(null);
    setLists(null);
  }

  // Every action asks first, says what happened, and reloads the numbers.
  async function act(action: string, id: string, confirmText: string, ids?: string[]) {
    if (!window.confirm(confirmText)) return;
    setNote("처리 중…");
    const r = await getJson<{ ok: boolean; error?: string; removed?: number; was?: number; rooms?: number }>("/api/admin/action", { method: "POST", body: JSON.stringify({ action, id, ids }) });
    if (!r.body?.ok) {
      setNote(r.body?.error === "has_subscription" ? "실패: 이 가족은 Stripe 구독이 살아 있습니다. Stripe에서 먼저 구독을 취소한 뒤 삭제하세요." : `실패: ${r.body?.error ?? `HTTP ${r.status}`}`);
      return;
    }
    setNote(`완료: ${ACTION_KO[action] ?? action}${r.body.removed !== undefined ? ` (${r.body.removed}개)` : ""}`);
    setFamily(null);
    await load();
  }

  async function rebuildSearch() {
    setNote("다시 만드는 중…");
    const r = await getJson<{ ok: boolean; listed?: number; schools?: number; ms?: number; error?: string }>("/api/admin/rebuild", { method: "POST" });
    setNote(r.body?.ok ? `완료: 공개 방 ${r.body.listed}개, 학교 ${r.body.schools}곳 (${r.body.ms} ms)` : `실패: ${r.body?.error ?? `HTTP ${r.status}`}`);
    if (r.body?.ok) await load();
  }

  async function openFamily(id: string) {
    setFamily(null);
    const r = await getJson<{ ok: boolean; family?: FamilyInfo; error?: string }>(`/api/admin/stats?family=${encodeURIComponent(id)}`);
    setFamily(r.body?.family ?? { error: r.body?.error ?? `HTTP ${r.status}` });
  }

  function downloadCsv() {
    if (!lists) return;
    const head = ["id", "createdAt", "updatedAt", "country", "language", "children", "items", "open", "sources", "monthUsage", "plan", "rooms", "push", "gmail"] as const;
    const csv = [head.join(","), ...lists.families.map((f) => head.map((k) => String(f[k])).join(","))].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `parentdesk-families-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if (authed === null) return <p className="p-8 text-sm text-zinc-500">불러오는 중…</p>;

  if (!authed) {
    return (
      <main className="mx-auto w-full max-w-sm px-4 py-16">
        <h1 className="text-xl font-bold">ParentDesk 관리자</h1>
        {off ? (
          <p className="mt-3 text-sm text-zinc-600">콘솔이 꺼져 있습니다. 서버에 ADMIN_TOKEN을 설정하세요.</p>
        ) : (
          <form onSubmit={login} className="mt-4 grid gap-3">
            <input className={INPUT} type="password" placeholder="관리자 토큰 (ADMIN_TOKEN)" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
            <button type="submit" className={BTN_PRIMARY} disabled={!token.trim()}>
              로그인
            </button>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <p className="text-xs text-zinc-500">토큰은 Vercel 환경 변수 ADMIN_TOKEN과 같습니다. 로그인은 12시간 유지됩니다.</p>
          </form>
        )}
      </main>
    );
  }

  const s = data?.stats;
  const maxDay = Math.max(1, ...(s?.notices.byDay.map((d) => d.n) ?? [1]));
  const obj = (m: Record<string, number>): [string, number][] => Object.entries(m).sort((a, b) => b[1] - a[1]);
  const q = filter.trim().toLowerCase();
  const hit = (...parts: (string | number | null | undefined)[]) => !q || parts.some((p) => String(p ?? "").toLowerCase().includes(q));
  // The rows on screen; the clean-up acts on exactly these, never on rows that are filtered out.
  const shownFamilies = (lists?.families ?? []).filter((f) => hit(f.id, f.country, f.language, f.plan)).slice(0, 300);
  const purgeIds = shownFamilies.filter((f) => f.empty).map((f) => f.id);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">ParentDesk 관리자</h1>
        <div className="flex gap-2">
          <button type="button" className={BTN_SECONDARY} onClick={load} disabled={loading}>
            {loading ? "새로 고치는 중…" : "새로 고침"}
          </button>
          <button type="button" className={BTN_SMALL} onClick={logout}>
            로그아웃
          </button>
        </div>
      </div>

      <nav className="mt-4 flex flex-wrap gap-2" role="tablist">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => {
              setTab(id);
              setFilter("");
            }}
            className={`rounded-full px-4 py-1.5 text-sm ${tab === id ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "border border-zinc-300 dark:border-zinc-700"}`}
          >
            {label}
            {lists && id === "families" && ` ${lists.families.length}`}
            {lists && id === "rooms" && ` ${lists.rooms.length}`}
            {lists && id === "schools" && ` ${lists.schools.length}`}
          </button>
        ))}
      </nav>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {note && (
        <p className="mt-3 rounded-lg bg-zinc-100 px-3 py-2 text-sm dark:bg-zinc-800" role="status">
          {note}
        </p>
      )}

      {tab === "overview" && s && data && (
        <>
          <p className="mt-3 text-xs text-zinc-500">
            {s.generatedAt.slice(0, 16).replace("T", " ")} UTC · 계산 {data.ms} ms{s.families.truncated && " · 가족 수가 많아 일부만 집계됨"}
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <Kpi label="가족" value={s.families.total} sub={`이번 주 +${s.families.created7d} · 이번 달 +${s.families.created30d}`} />
            <Kpi label="최근 7일 활동" value={s.families.active7d} sub={`항목 있음 ${s.families.withItems} · 아이 등록 ${s.families.withChildren}`} />
            <Kpi label="이번 달 안내문" value={s.notices.thisMonth} sub={`최근 7일 ${s.sources.last7d}건`} />
            <Kpi label="항목" value={s.items.total} sub={`진행 ${s.items.open} · 완료 ${s.items.done} · 확인 필요 ${s.items.needsCheck}`} />
            <Kpi label="아이" value={s.children} />
            <Kpi label="요금제" value={`${s.plans.family} / ${s.plans.free}`} sub="가족 / 무료" />
            {data.rooms && <Kpi label="알림방 / 선생님" value={`${data.rooms.rooms} / ${data.rooms.teachers}`} sub={`구독 ${data.rooms.members} · 게시 ${data.rooms.posts}(이번 주 ${data.rooms.posts7d}) · 전달 ${data.rooms.delivered}`} />}
            {data.search && (
              <Kpi
                label="반 찾기: 공개 방 / 학교"
                value={`${data.search.listedRooms} / ${data.search.schools}`}
                sub={`검색 목록 ${data.search.directoryEntries}건${data.search.directoryEntries !== data.search.listedRooms ? " (불일치: 시스템 탭에서 재구성)" : ""} · 방을 구독한 가족 ${s.following}`}
              />
            )}
            <Kpi label="알림 켠 기기" value={s.push.devices} sub={`${s.push.families}가족`} />
            <Kpi label="Gmail 연결" value={s.gmail.connected} sub={`중단 ${s.gmail.paused}`} />
            <Kpi label="주간 요약 켬" value={s.digest.on} sub={`유효한 초대 링크 ${s.invites.live}`} />
          </div>

          <section className={`${CARD} mt-4`}>
            <h3 className="text-sm font-semibold">하루 안내문 수 (14일)</h3>
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
            <Pairs title="항목 유형" rows={obj(s.items.byType)} />
            <Pairs title="안내문이 들어온 경로" rows={obj(s.sources.byKind)} />
            <Pairs title="나라" rows={s.top.countries} />
            <Pairs title="결과 언어" rows={s.top.languages} />
            <Pairs title="화면 언어" rows={s.top.locales} />
            <Pairs title="기능 사용 누적" rows={obj(s.counters)} />
          </div>
        </>
      )}

      {tab !== "overview" && tab !== "system" && (
        <input className={`${INPUT} mt-4 max-w-sm`} placeholder="검색 (id, 이름, 학교, 나라…)" value={filter} onChange={(e) => setFilter(e.target.value)} />
      )}

      {tab === "families" && lists && (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" className={BTN_SMALL} onClick={downloadCsv}>
              CSV 내려받기
            </button>
            <button type="button" className={DANGER} disabled={purgeIds.length === 0} onClick={() => act("families_purge", "", `아래 표에 "빈 가족"으로 표시된 ${purgeIds.length}개(한 번도 쓰지 않았고 30일 넘게 손대지 않음)를 삭제합니다. 되돌릴 수 없습니다. 계속할까요?`, purgeIds)}>
              안 쓰는 빈 가족 정리 ({purgeIds.length})
            </button>
            <span className="text-xs text-zinc-500">이름·항목 내용은 표시하지 않습니다. 숫자와 설정만 보입니다.</span>
          </div>
          <div className={`${CARD} mt-3 overflow-x-auto p-0`}>
            <table className="w-full">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  {["가족 id", "만든 날", "마지막 활동", "나라", "언어", "아이", "항목(진행)", "안내문", "이번 달", "요금제", "방", "알림", ""].map((h) => (
                    <th key={h} className={TH}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shownFamilies.map((f) => (
                    <tr key={f.id} className="border-b border-zinc-100 dark:border-zinc-800">
                      <td className={`${TD} font-mono text-xs`}>
                        {f.id}
                        {f.empty && <span className="ml-1 rounded bg-zinc-200 px-1 text-[10px] dark:bg-zinc-700">빈 가족</span>}
                      </td>
                      <td className={TD}>{day(f.createdAt)}</td>
                      <td className={TD}>{day(f.updatedAt)}</td>
                      <td className={TD}>{f.country}</td>
                      <td className={TD}>{f.language}</td>
                      <td className={`${TD} tabular-nums`}>{f.children}</td>
                      <td className={`${TD} tabular-nums`}>
                        {f.items} ({f.open})
                      </td>
                      <td className={`${TD} tabular-nums`}>{f.sources}</td>
                      <td className={`${TD} tabular-nums`}>{f.monthUsage}</td>
                      <td className={TD}>{f.plan === "family" ? "가족" : "무료"}</td>
                      <td className={`${TD} tabular-nums`}>{f.rooms}</td>
                      <td className={`${TD} tabular-nums`}>{f.push}</td>
                      <td className={TD}>
                        <span className="flex gap-1">
                          <button type="button" className={BTN_SMALL} onClick={() => openFamily(f.id)}>
                            상세
                          </button>
                          <button type="button" className={BTN_SMALL} onClick={() => act("family_reset_usage", f.id, `가족 ${f.id}의 이번 달 사용량(${f.monthUsage})을 0으로 되돌립니다. 계속할까요?`)}>
                            사용량 0
                          </button>
                          <button type="button" className={DANGER} onClick={() => act("family_delete", f.id, `가족 ${f.id}와 그 안의 항목 ${f.items}개를 모두 삭제합니다. 되돌릴 수 없습니다. 계속할까요?`)}>
                            삭제
                          </button>
                        </span>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {family && <pre className="mt-3 overflow-auto rounded-lg bg-zinc-100 p-3 text-xs dark:bg-zinc-800">{JSON.stringify(family, null, 2)}</pre>}
        </>
      )}

      {tab === "rooms" && lists && (
        <>
          <h2 className="mt-4 text-sm font-semibold">알림방 {lists.rooms.length}</h2>
          <div className={`${CARD} mt-2 overflow-x-auto p-0`}>
            <table className="w-full">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  {["학교", "학년·반", "방 이름", "선생님", "구독", "게시", "마지막 안내", "검색 공개", ""].map((h) => (
                    <th key={h} className={TH}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lists.rooms
                  .filter((r) => hit(r.id, r.school, r.name, r.teacherName, r.grade, r.classLabel))
                  .map((r) => (
                    <tr key={r.id} className="border-b border-zinc-100 dark:border-zinc-800">
                      <td className={TD} dir="auto">{r.school || "-"}</td>
                      <td className={TD} dir="auto">{[r.grade, r.classLabel].filter(Boolean).join("-") || "-"}</td>
                      <td className={TD} dir="auto">{r.name}</td>
                      <td className={TD} dir="auto">
                        {r.teacherName || "-"}
                        {r.orphan && <span className="ml-1 rounded bg-amber-200 px-1 text-[10px] text-amber-900">선생님 없음</span>}
                      </td>
                      <td className={`${TD} tabular-nums`}>{r.members}</td>
                      <td className={`${TD} tabular-nums`}>
                        {r.posts}
                        {r.drafts > 0 && ` (+초안 ${r.drafts})`}
                      </td>
                      <td className={TD}>{day(r.lastPostAt)}</td>
                      <td className={TD}>{r.listed ? "공개" : "-"}</td>
                      <td className={TD}>
                        <span className="flex gap-1">
                          {r.listed && (
                            <button type="button" className={BTN_SMALL} onClick={() => act("room_unlist", r.id, `"${r.school} ${r.name}" 방을 반 찾기 검색에서 내립니다. 방과 기존 구독, 초대 링크·QR은 그대로이지만 참여 코드로 들어오는 것은 멈춥니다. 계속할까요?`)}>
                              검색에서 내림
                            </button>
                          )}
                          <button type="button" className={DANGER} onClick={() => act("room_delete", r.id, `"${r.school} ${r.name}" 방을 삭제합니다(구독 ${r.members}가정). 이미 전달된 항목은 가정에 남습니다. 되돌릴 수 없습니다. 계속할까요?`)}>
                            삭제
                          </button>
                        </span>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          <h2 className="mt-6 text-sm font-semibold">선생님 {lists.teachers.length}</h2>
          <div className={`${CARD} mt-2 overflow-x-auto p-0`}>
            <table className="w-full">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  {["이름", "학교", "지역", "나라", "방", "이번 달 게시", "만든 날", "id", ""].map((h) => (
                    <th key={h} className={TH}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lists.teachers
                  .filter((t) => hit(t.id, t.name, t.school, t.region, t.city, t.country))
                  .map((t) => (
                    <tr key={t.id} className="border-b border-zinc-100 dark:border-zinc-800">
                      <td className={TD} dir="auto">{t.name}</td>
                      <td className={TD} dir="auto">{t.school || "-"}</td>
                      <td className={TD} dir="auto">{[t.region, t.city].filter(Boolean).join(" ") || "-"}</td>
                      <td className={TD}>{t.country}</td>
                      <td className={`${TD} tabular-nums`}>{t.rooms}</td>
                      <td className={`${TD} tabular-nums`}>{t.monthPosts}</td>
                      <td className={TD}>{day(t.createdAt)}</td>
                      <td className={`${TD} font-mono text-xs`}>{t.id}</td>
                      <td className={TD}>
                        <button type="button" className={DANGER} onClick={() => act("teacher_delete", t.id, `선생님 "${t.name}"의 데스크와 방 ${t.rooms}개를 삭제합니다. 되돌릴 수 없습니다. 계속할까요?`)}>
                          삭제
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "schools" && lists && (
        <div className={`${CARD} mt-3 overflow-x-auto p-0`}>
          <table className="w-full">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800">
                {["학교", "지역", "나라", "공개 방", "선생님", "id"].map((h) => (
                  <th key={h} className={TH}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lists.schools
                .filter((x) => hit(x.name, x.region, x.city, x.country))
                .map((x) => (
                  <tr key={x.id} className="border-b border-zinc-100 dark:border-zinc-800">
                    <td className={TD} dir="auto">{x.name}</td>
                    <td className={TD} dir="auto">{[x.region, x.city].filter(Boolean).join(" ") || "-"}</td>
                    <td className={TD}>{x.country}</td>
                    <td className={`${TD} tabular-nums`}>{x.rooms}</td>
                    <td className={`${TD} tabular-nums`}>{x.teachers}</td>
                    <td className={`${TD} font-mono text-xs`}>{x.id}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          {lists.schools.length === 0 && <p className="p-4 text-sm text-zinc-500">등록된 학교가 없습니다.</p>}
        </div>
      )}

      {tab === "system" && data && lists && (
        <>
          <section className={`${CARD} mt-4`}>
            <h3 className="text-sm font-semibold">서버 설정 체크리스트</h3>
            <ul className="mt-2 grid gap-2">
              {lists.checklist.map((c) => (
                <li key={c.key} className="flex items-start gap-2 text-sm">
                  <span className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${c.on ? "bg-emerald-600" : "bg-zinc-400"}`}>{c.on ? "✓" : "–"}</span>
                  <span>
                    <span className="font-medium">{CHECK[c.key]?.[0] ?? c.key}</span> <span className="text-zinc-500">{c.on ? "켜짐" : "꺼짐"}</span>
                    <span className="block text-xs text-zinc-500">{CHECK[c.key]?.[1]}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-zinc-500">
              저장소 {data.server.storage} · 모델 {data.server.extractModel} / {data.server.assistModel} / {data.server.classifyModel} · 하루 한도 {data.server.dailyCap}
            </p>
          </section>

          <section className={`${CARD} mt-4`}>
            <h3 className="text-sm font-semibold">유지 보수</h3>
            <p className="mt-1 text-xs text-zinc-500">반 찾기 검색 목록과 학교 명단은 방·선생님 정보에서 만든 사본입니다. 수치가 맞지 않으면 다시 만드세요.</p>
            <button type="button" className={`${BTN_SECONDARY} mt-3`} onClick={rebuildSearch}>
              반 찾기 다시 만들기
            </button>
          </section>

          <section className={`${CARD} mt-4`}>
            <h3 className="text-sm font-semibold">예약 작업 기록</h3>
            {Object.keys(data.runs).length === 0 && <p className="mt-2 text-xs text-zinc-500">아직 기록이 없습니다.</p>}
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
            <h3 className="text-sm font-semibold">관리자 작업 기록</h3>
            {lists.log.length === 0 && <p className="mt-2 text-xs text-zinc-500">아직 기록이 없습니다.</p>}
            <ul className="mt-2 grid gap-1 text-xs">
              {lists.log.map((l, i) => (
                <li key={`${l.at}-${i}`} className="font-mono">
                  {l.at.slice(0, 16).replace("T", " ")} · {ACTION_KO[l.action] ?? l.action} · {l.target} · {l.note}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}

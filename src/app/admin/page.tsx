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
  teacherSignups?: { day: string; n: number }[];
  teacherPosts?: number;
  me?: { name: string; role: "owner" | "viewer" };
  admins?: { name: string; role: string; twoStep: boolean; source: string; createdAt: string | null }[];
  usage?: { month: string; models: Record<string, { calls: number; input: number; output: number; cacheRead: number; cacheWrite: number }>; byDay: { day: string; calls: number }[] };
  runs: Record<string, Run[]>;
  server: { storage: string; features: Record<string, boolean>; extractModel: string; assistModel: string; classifyModel: string; dailyCap: number };
  ms: number;
};
type TeacherRow = { blocked: boolean; id: string; name: string; school: string; region: string; city: string; country: string; rooms: number; monthPosts: number; createdAt: string };
type RoomRow = { id: string; teacherId: string; teacherName: string; school: string; grade: string; classLabel: string; name: string; members: number; posts: number; drafts: number; lastPostAt: string | null; listed: boolean; createdAt: string; orphan: boolean };
type SchoolRow = { id: string; name: string; region: string; city: string; country: string; rooms: number; teachers: number };
type Lists = { families: FamilyRow[]; teachers: TeacherRow[]; rooms: RoomRow[]; schools: SchoolRow[]; log: AdminAction[]; checklist: { key: string; on: boolean }[]; abandoned: string[]; announcement: { id: string; text: string; texts?: Record<string, string>; audience: string; until: string } | null };
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
  twostep: ["관리자 2단계 로그인(모든 계정)", "한 계정이라도 꺼져 있으면 그 계정은 토큰만으로 들어옵니다. scripts/admin-2fa.mjs로 비밀값을 만들어 ADMIN_TOTP_SECRET에 넣으면 6자리 코드를 함께 묻습니다."],
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
  family_note: "가족 메모",
  family_block: "가족 일시 중지/해제",
  announce: "공지",
  teacher_block: "선생님 일시 중지/해제",
  admin_add: "관리자 계정 추가",
  admin_remove: "관리자 계정 회수",
  rebuild: "반 찾기·사용량 정리",
};

async function getJson<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T | null }> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  } catch {
    // No answer at all (offline, server restarting): say so instead of leaving the screen stuck.
    return { status: 0, body: { ok: false, error: "서버에 연결하지 못했습니다. 잠시 뒤 새로 고침 하세요." } as T };
  }
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
  const [code, setCode] = useState("");
  const [now] = useState(() => Date.now()); // "today" for the charts, fixed when the page opened
  const [twoStep, setTwoStep] = useState(false);
  const canAct = data?.me?.role !== "viewer";
  const [annText, setAnnText] = useState("");
  const [annAudience, setAnnAudience] = useState("all");
  const [annDays, setAnnDays] = useState(7);
  const [price, setPrice] = useState<Record<string, { in: string; out: string }>>({});
  const [annTranslate, setAnnTranslate] = useState(true);
  const [newAdmin, setNewAdmin] = useState({ name: "", role: "viewer", twoStep: false });
  const [issued, setIssued] = useState<{ name: string; role: string; token: string; totp: string | null; totpUri: string | null } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const r = await getJson<Payload & { ok: boolean; error?: string }>("/api/admin/stats");
    if (r.status === 404 || r.status === 401) {
      void getJson<{ twoStep?: boolean }>("/api/admin/login").then((x) => setTwoStep(x.body?.twoStep === true));
      setLoading(false);
      setOff(r.status === 404);
      setAuthed(false);
      setIssued(null);
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
    if (l.body?.ok) {
      setLists(l.body);
      setAnnText(l.body.announcement?.text ?? "");
      if (l.body.announcement) setAnnAudience(l.body.announcement.audience);
    }
    try {
      setPrice(JSON.parse(window.localStorage.getItem("pd_admin_price") ?? "") as Record<string, { in: string; out: string }>);
    } catch {
      /* nothing saved yet */
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from the server
    void load();
  }, [load]);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const r = await getJson<{ ok: boolean; error?: string }>("/api/admin/login", { method: "POST", body: JSON.stringify({ token, code }) });
    if (!r.body?.ok) {
      setError(r.body?.error === "bad_token" ? "토큰이 맞지 않습니다." : r.body?.error === "bad_code" ? "인증 코드가 맞지 않습니다." : r.body?.error === "rate_limited" ? "시도가 너무 많습니다. 한 시간 뒤에 다시 하세요." : (r.body?.error ?? `HTTP ${r.status}`));
      return;
    }
    setToken("");
    setCode("");
    await load();
  }

  async function logout() {
    await fetch("/api/admin/login", { method: "DELETE" });
    setAuthed(false);
    setData(null);
    setLists(null);
    setIssued(null);
    setNote("");
    // an account made in this session may have switched the second step on
    void getJson<{ twoStep?: boolean }>("/api/admin/login").then((x) => setTwoStep(x.body?.twoStep === true));
  }

  // Every action asks first, says what happened, and reloads the numbers.
  async function act(action: string, id: string, confirmText: string, ids?: string[], extra: Record<string, unknown> = {}) {
    if (!canAct) {
      setNote("읽기 전용 계정입니다. 변경은 owner 계정으로만 할 수 있습니다.");
      return;
    }
    if (confirmText && !window.confirm(confirmText)) return;
    setNote("처리 중…");
    const r = await getJson<{ ok: boolean; error?: string; removed?: number; was?: number; rooms?: number }>("/api/admin/action", { method: "POST", body: JSON.stringify({ action, id, ids, ...extra }) });
    if (!r.body?.ok) {
      setNote(r.body?.error === "has_subscription" ? "실패: 이 가족은 Stripe 구독이 살아 있습니다. Stripe에서 먼저 구독을 취소한 뒤 삭제하세요." : `실패: ${r.body?.error ?? `HTTP ${r.status}`}`);
      return;
    }
    setNote(`완료: ${ACTION_KO[action] ?? action}${r.body.removed !== undefined ? ` (${r.body.removed}개)` : ""}`);
    setFamily(null);
    await load();
  }

  // A new account: its token (and second-step secret) are shown once, here, and nowhere else.
  async function addAdmin() {
    if (!canAct) {
      setNote("읽기 전용 계정입니다. 변경은 owner 계정으로만 할 수 있습니다.");
      return;
    }
    setIssued(null);
    const r = await getJson<{ ok: boolean; error?: string; account?: { name: string; role: string; token: string; totp: string | null; totpUri: string | null } }>("/api/admin/action", { method: "POST", body: JSON.stringify({ action: "admin_add", ...newAdmin }) });
    if (!r.body?.ok || !r.body.account) {
      const why: Record<string, string> = { bad_name: "이름은 영문 소문자·숫자·-·_ 로 20자까지입니다.", exists: "이미 있는 이름입니다.", too_many: "계정이 너무 많습니다(최대 20)." };
      setNote(`실패: ${why[r.body?.error ?? ""] ?? r.body?.error ?? `HTTP ${r.status}`}`);
      return;
    }
    setIssued(r.body.account);
    setNewAdmin({ name: "", role: "viewer", twoStep: false });
    setNote("완료: 관리자 계정 추가. 아래 토큰을 지금 복사해 전달하세요. 다시 볼 수 없습니다.");
    await load();
  }

  async function rebuildSearch() {
    if (!canAct) {
      setNote("읽기 전용 계정입니다. 변경은 owner 계정으로만 할 수 있습니다.");
      return;
    }
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

  if (authed === null)
    return error ? (
      <div className="p-8 text-sm">
        <p className="text-red-600">{error}</p>
        <button type="button" className={`${BTN_SECONDARY} mt-3`} onClick={() => void load()}>
          다시 시도
        </button>
      </div>
    ) : (
      <p className="p-8 text-sm text-zinc-500">불러오는 중…</p>
    );

  if (!authed) {
    return (
      <main className="mx-auto w-full max-w-sm px-4 py-16">
        <h1 className="text-xl font-bold">ParentDesk 관리자</h1>
        {off ? (
          <p className="mt-3 text-sm text-zinc-600">콘솔이 꺼져 있습니다. 서버에 ADMIN_TOKEN을 설정하세요.</p>
        ) : (
          <form onSubmit={login} className="mt-4 grid gap-3">
            <input className={INPUT} type="password" placeholder="관리자 토큰" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
            {twoStep && <input className={INPUT} inputMode="numeric" placeholder="인증 앱의 6자리 코드 (2단계를 켠 계정만)" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" maxLength={7} />}
            <button type="submit" className={BTN_PRIMARY} disabled={!token.trim()}>
              로그인
            </button>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <p className="text-xs text-zinc-500">운영자는 Vercel 환경 변수 ADMIN_TOKEN, 그 밖의 계정은 발급받은 토큰을 넣으세요. 로그인은 12시간 유지됩니다.</p>
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
  // Sign-ups per day over the last 30 days, families and teachers.
  // (counted on the server over every family and teacher, not over the rows listed here)
  const dayKeys = (s?.signups ?? []).map((d) => d.day);
  const famDays = (s?.signups ?? []).map((d) => d.n);
  const teachDays = dayKeys.map((d) => data?.teacherSignups?.find((x) => x.day === d)?.n ?? 0);
  const maxSign = Math.max(1, ...famDays, ...teachDays);
  // Measured spend: the tokens every model call reported this month, per model, times the
  // prices per million tokens the operator types in (kept in this browser).
  const usageRows = Object.entries(data?.usage?.models ?? {}).sort((a, b) => b[1].calls - a[1].calls);
  const num = (x: string | undefined) => (x !== undefined && x.trim() !== "" && Number.isFinite(Number(x)) ? Number(x) : null);
  const costOf = (model: string, t: { input: number; output: number }) => {
    const pi = num(price[model]?.in);
    const po = num(price[model]?.out);
    return pi === null || po === null ? null : (t.input * pi + t.output * po) / 1_000_000;
  };
  const totalCost = usageRows.every(([m, t]) => costOf(m, t) !== null) && usageRows.length > 0 ? usageRows.reduce((sum, [m, t]) => sum + (costOf(m, t) as number), 0) : null;
  const savePrice = (model: string, key: "in" | "out", value: string) => {
    const next = { ...price, [model]: { in: price[model]?.in ?? "", out: price[model]?.out ?? "", [key]: value } };
    setPrice(next);
    try {
      window.localStorage.setItem("pd_admin_price", JSON.stringify(next));
    } catch {
      /* storage unavailable */
    }
  };
  // The scheduled jobs should have run within two days when they are switched on.
  const lastRun = Object.values(data?.runs ?? {}).flatMap((r) => r.map((x) => x.at)).sort().pop();
  const cronOn = lists?.checklist.find((c) => c.key === "cron")?.on === true;
  const cronStale = cronOn && (!lastRun || now - Date.parse(lastRun) > 2 * 86400000);
  void now;
  // The rows on screen; the clean-up acts on exactly these, never on rows that are filtered out.
  const shownFamilies = (lists?.families ?? []).filter((f) => hit(f.id, f.country, f.language, f.plan)).slice(0, 300);
  const purgeIds = shownFamilies.filter((f) => f.empty).map((f) => f.id);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">
          ParentDesk 관리자
          {data?.me && <span className="ml-2 align-middle text-xs font-normal text-zinc-500">{data.me.name} · {data.me.role === "owner" ? "owner(전체 권한)" : "viewer(읽기 전용)"}</span>}
        </h1>
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

          {cronStale && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" role="status">
              예약 작업이 이틀 넘게 기록되지 않았습니다{lastRun ? ` (마지막 ${lastRun.slice(0, 16).replace("T", " ")} UTC)` : " (기록 없음)"}. Vercel의 Cron 설정을 확인하세요.
            </p>
          )}

          <section className={`${CARD} mt-4`}>
            <h3 className="text-sm font-semibold">가입 추이 (30일){s.families.truncated && " · 가족 수가 많아 일부만 집계됨"}</h3>
            <p className="mt-1 text-xs text-zinc-500">
              <span className="mr-3 inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-indigo-500" /> 가족 {famDays.reduce((a, b) => a + b, 0)}</span>
              <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-emerald-500" /> 선생님 {teachDays.reduce((a, b) => a + b, 0)}</span>
            </p>
            <div className="mt-3 flex h-24 items-end gap-0.5">
              {dayKeys.map((d, i) => (
                <div key={d} className="flex flex-1 flex-col items-center gap-1" title={`${d}: 가족 ${famDays[i]}, 선생님 ${teachDays[i]}`}>
                  <div className="flex w-full items-end gap-px">
                    <div className="flex-1 rounded-t bg-indigo-500" style={{ height: `${famDays[i] ? Math.max(3, (famDays[i] / maxSign) * 76) : 1}px` }} />
                    <div className="flex-1 rounded-t bg-emerald-500" style={{ height: `${teachDays[i] ? Math.max(3, (teachDays[i] / maxSign) * 76) : 1}px` }} />
                  </div>
                  <span className="text-[8px] text-zinc-500">{i % 3 === 0 ? d.slice(8) : ""}</span>
                </div>
              ))}
            </div>
          </section>

          <section className={`${CARD} mt-4`}>
            <h3 className="text-sm font-semibold">AI 사용량 (이번 달 실측)</h3>
            <p className="mt-1 text-xs text-zinc-500">모델이 응답마다 보고한 토큰 수를 그대로 더한 값입니다(기록을 시작한 뒤의 호출만). 단가는 100만 토큰당 가격을 직접 넣으세요. 이 브라우저에만 저장됩니다.</p>
            {usageRows.length === 0 ? (
              <p className="mt-3 text-sm text-zinc-500">이번 달 기록된 호출이 아직 없습니다.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-zinc-200 dark:border-zinc-800">
                      {["모델", "호출", "입력 토큰", "출력 토큰", "캐시 읽기", "캐시 쓰기", "입력 단가", "출력 단가", "비용"].map((h) => (
                        <th key={h} className={TH}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {usageRows.map(([model, t]) => (
                      <tr key={model} className="border-b border-zinc-100 dark:border-zinc-800">
                        <td className={`${TD} font-mono text-xs`}>{model}</td>
                        <td className={`${TD} tabular-nums`}>{t.calls.toLocaleString()}</td>
                        <td className={`${TD} tabular-nums`}>{t.input.toLocaleString()}</td>
                        <td className={`${TD} tabular-nums`}>{t.output.toLocaleString()}</td>
                        <td className={`${TD} tabular-nums`}>{t.cacheRead.toLocaleString()}</td>
                        <td className={`${TD} tabular-nums`}>{t.cacheWrite.toLocaleString()}</td>
                        <td className={TD}>
                          <input className={`${INPUT} w-20`} inputMode="decimal" aria-label={`${model} 입력 단가`} value={price[model]?.in ?? ""} onChange={(e) => savePrice(model, "in", e.target.value)} />
                        </td>
                        <td className={TD}>
                          <input className={`${INPUT} w-20`} inputMode="decimal" aria-label={`${model} 출력 단가`} value={price[model]?.out ?? ""} onChange={(e) => savePrice(model, "out", e.target.value)} />
                        </td>
                        <td className={`${TD} font-semibold tabular-nums`}>{costOf(model, t) === null ? "-" : (costOf(model, t) as number).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {(data.usage?.byDay.length ?? 0) > 0 && (
              <div className="mt-3">
                <p className="text-xs text-zinc-500">하루 호출 수 (이번 달)</p>
                <div className="mt-2 flex h-20 items-end gap-0.5">
                  {(data.usage?.byDay ?? []).map((d) => (
                    <div key={d.day} className="flex flex-1 flex-col items-center gap-1" title={`${d.day}: ${d.calls}회`}>
                      <div className="w-full max-w-6 rounded-t bg-indigo-500" style={{ height: `${Math.max(3, (d.calls / Math.max(1, ...(data.usage?.byDay ?? []).map((x) => x.calls))) * 64)}px` }} />
                      <span className="text-[9px] text-zinc-500">{d.day.slice(8)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <p className="mt-2 text-sm font-semibold">{totalCost === null ? "모든 모델의 단가를 넣으면 합계가 나옵니다." : `이번 달 합계 약 ${totalCost.toFixed(2)}`}</p>
            <p className="mt-1 text-xs text-zinc-500">거절되거나 쓸 수 없던 응답도 포함되지만, 응답 해석 단계에서 실패한 드문 호출은 빠질 수 있습니다. 비용은 입력·출력 토큰만으로 계산합니다. 캐시 읽기·쓰기 토큰은 단가가 달라 따로 보여 주기만 하므로, 실제 청구액과 조금 다를 수 있습니다. 하루 한도는 {data.server.dailyCap}건입니다.</p>
          </section>

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
                        {f.blocked && <span className="ml-1 rounded bg-red-200 px-1 text-[10px] text-red-900">중지됨</span>}
                        {f.note && <span className="ml-1 rounded bg-amber-200 px-1 text-[10px] text-amber-900" title={f.note}>메모</span>}
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
                          <button
                            type="button"
                            className={BTN_SMALL}
                            onClick={() => {
                              const note = window.prompt(`가족 ${f.id} 메모 (운영자만 봅니다, 비우면 삭제)`, f.note);
                              if (note !== null) void act("family_note", f.id, "", undefined, { note });
                            }}
                          >
                            메모
                          </button>
                          <button
                            type="button"
                            className={BTN_SMALL}
                            onClick={() => act("family_block", f.id, f.blocked ? `가족 ${f.id}의 일시 중지를 풉니다. 계속할까요?` : `가족 ${f.id}의 AI 사용(안내문 추가·질문·답장)을 일시 중지합니다. 목록은 계속 볼 수 있습니다. 계속할까요?`, undefined, { blocked: !f.blocked })}
                          >
                            {f.blocked ? "중지 해제" : "일시 중지"}
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
                      <td className={TD} dir="auto">
                        {t.name}
                        {t.blocked && <span className="ml-1 rounded bg-red-200 px-1 text-[10px] text-red-900">중지됨</span>}
                      </td>
                      <td className={TD} dir="auto">{t.school || "-"}</td>
                      <td className={TD} dir="auto">{[t.region, t.city].filter(Boolean).join(" ") || "-"}</td>
                      <td className={TD}>{t.country}</td>
                      <td className={`${TD} tabular-nums`}>{t.rooms}</td>
                      <td className={`${TD} tabular-nums`}>{t.monthPosts}</td>
                      <td className={TD}>{day(t.createdAt)}</td>
                      <td className={`${TD} font-mono text-xs`}>{t.id}</td>
                      <td className={TD}>
                        <span className="flex gap-1">
                          <button
                            type="button"
                            className={BTN_SMALL}
                            onClick={() => {
                              if (t.blocked) return void act("teacher_block", t.id, `선생님 "${t.name}"의 일시 중지를 풉니다. 계속할까요?`, undefined, { blocked: false });
                              const reason = window.prompt(`선생님 "${t.name}"의 안내문 읽기·작성·보내기를 일시 중지합니다. 방과 구독은 그대로입니다.\n선생님에게 보여 줄 사유를 적으세요(비워도 됩니다).`, "");
                              if (reason !== null) void act("teacher_block", t.id, "", undefined, { blocked: true, reason });
                            }}
                          >
                            {t.blocked ? "중지 해제" : "일시 중지"}
                          </button>
                        <button type="button" className={DANGER} onClick={() => act("teacher_delete", t.id, `선생님 "${t.name}"의 데스크와 방 ${t.rooms}개를 삭제합니다. 되돌릴 수 없습니다. 계속할까요?`)}>
                          삭제
                        </button>
                        </span>
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
            <h3 className="text-sm font-semibold">관리자 계정 {data.admins?.length ?? 0}</h3>
            <ul className="mt-2 grid gap-2 text-sm">
              {(data.admins ?? []).map((u) => (
                <li key={u.name} className="flex flex-wrap items-center gap-2">
                  <span>
                    <span className="font-mono">{u.name}</span> · {u.role === "owner" ? "owner(전체 권한)" : "viewer(읽기 전용)"} · 2단계 {u.twoStep ? "켜짐" : "꺼짐"} · {u.source === "env" ? "환경 변수" : `화면에서 추가${u.createdAt ? ` ${u.createdAt.slice(0, 10)}` : ""}`}
                  </span>
                  {u.source === "stored" && u.name !== data.me?.name && (
                    <button type="button" className={DANGER} onClick={() => act("admin_remove", "", `관리자 계정 "${u.name}"을 회수합니다. 그 계정은 즉시 로그아웃됩니다. 계속할까요?`, undefined, { name: u.name })}>
                      회수
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <input className={`${INPUT} w-40`} placeholder="새 계정 이름 (영문)" value={newAdmin.name} maxLength={20} onChange={(e) => setNewAdmin({ ...newAdmin, name: e.target.value })} />
              <select className={`${INPUT} w-auto`} value={newAdmin.role} onChange={(e) => setNewAdmin({ ...newAdmin, role: e.target.value })} aria-label="역할">
                <option value="viewer">viewer (읽기 전용)</option>
                <option value="owner">owner (전체 권한)</option>
              </select>
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={newAdmin.twoStep} onChange={(e) => setNewAdmin({ ...newAdmin, twoStep: e.target.checked })} />
                2단계 로그인
              </label>
              <button type="button" className={BTN_PRIMARY} disabled={!newAdmin.name.trim()} onClick={addAdmin}>
                계정 추가
              </button>
            </div>
            {issued && (
              <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/40" role="status">
                <p className="font-semibold">
                  {issued.name} ({issued.role}) 의 로그인 정보입니다. 지금만 보입니다.
                </p>
                <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">토큰</p>
                <code className="block select-all break-all rounded bg-white px-2 py-1 text-xs dark:bg-zinc-900">{issued.token}</code>
                {issued.totp && (
                  <>
                    <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">2단계 비밀값 (인증 앱에 등록)</p>
                    <code className="block select-all break-all rounded bg-white px-2 py-1 text-xs dark:bg-zinc-900">{issued.totp}</code>
                    <code className="mt-1 block select-all break-all rounded bg-white px-2 py-1 text-xs dark:bg-zinc-900">{issued.totpUri}</code>
                  </>
                )}
                <button type="button" className={`${BTN_SMALL} mt-2`} onClick={() => setIssued(null)}>
                  복사했습니다. 닫기
                </button>
              </div>
            )}
            <p className="mt-2 text-xs text-zinc-500">
              viewer는 모든 화면을 보지만 삭제·중지·공지·재구성·계정 관리는 할 수 없습니다. 서버에는 토큰의 해시만 저장되어, 잃어버리면 회수하고 새로 만들어야 합니다. 환경 변수(ADMIN_TOKEN, ADMIN_USERS)의 계정은 Vercel에서만 바꿀 수 있습니다.
            </p>
          </section>

          <section className={`${CARD} mt-4`}>
            <h3 className="text-sm font-semibold">공지 띄우기</h3>
            <p className="mt-1 text-xs text-zinc-500">선생님 데스크와 가족 홈 맨 위에 한 줄 공지가 뜹니다(한 번에 하나, 닫을 수 있음). 자동 번역을 켜면 10개 화면 언어로 옮겨 각자의 언어로 보입니다(AI 호출 1회).</p>
            {lists.announcement && (
              <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-300">
                지금 게시 중: {lists.announcement.audience === "teachers" ? "선생님" : lists.announcement.audience === "families" ? "가족" : "모두"} · {lists.announcement.until.slice(0, 10)}까지
              </p>
            )}
            {lists.announcement?.texts && (
              <details className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
                <summary className="cursor-pointer">번역된 문구 보기</summary>
                <ul className="mt-1 grid gap-1">
                  {Object.entries(lists.announcement.texts).map(([lang, text]) => (
                    <li key={lang} dir="auto">
                      <span className="font-mono">{lang}</span> {text}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <textarea className={`${INPUT} mt-2`} rows={3} maxLength={500} placeholder="예: 11월 15일(일) 02:00–03:00 점검으로 잠시 접속이 안 될 수 있습니다." value={annText} onChange={(e) => setAnnText(e.target.value)} />
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <select className={`${INPUT} w-auto`} value={annAudience} onChange={(e) => setAnnAudience(e.target.value)} aria-label="대상">
                <option value="all">모두</option>
                <option value="teachers">선생님만</option>
                <option value="families">가족만</option>
              </select>
              <select className={`${INPUT} w-auto`} value={annDays} onChange={(e) => setAnnDays(Number(e.target.value))} aria-label="기간">
                {[1, 3, 7, 14, 30].map((d) => (
                  <option key={d} value={d}>
                    {d}일 동안
                  </option>
                ))}
              </select>
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={annTranslate} onChange={(e) => setAnnTranslate(e.target.checked)} />
                10개 언어로 자동 번역
              </label>
              <button type="button" className={BTN_PRIMARY} disabled={!annText.trim()} onClick={() => act("announce", "", `이 공지를 ${annAudience === "teachers" ? "선생님" : annAudience === "families" ? "가족" : "모두"}에게 ${annDays}일 동안 띄웁니다${annTranslate ? "(10개 언어로 번역)" : ""}. 계속할까요?`, undefined, { text: annText, audience: annAudience, days: annDays, translate: annTranslate })}>
                공지 게시
              </button>
              {lists.announcement && (
                <button type="button" className={BTN_SMALL} onClick={() => act("announce", "", "지금 공지를 내립니다. 계속할까요?", undefined, { text: "" })}>
                  공지 내리기
                </button>
              )}
            </div>
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
                  {l.at.slice(0, 16).replace("T", " ")} · {l.by || "owner"} · {ACTION_KO[l.action] ?? l.action} · {l.target} · {l.note}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}

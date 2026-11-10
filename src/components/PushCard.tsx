"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { useFamily } from "@/lib/family-context";
import { useI18n } from "@/lib/i18n/context";
import { BTN_PRIMARY, BTN_SECONDARY, CARD } from "@/lib/ui";

// "Tell me when the teacher posts": web push for this device. Shown only when the server
// has push keys. On an iPhone it works once the app is on the home screen.

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function shortHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

async function registration(): Promise<ServiceWorkerRegistration> {
  return (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js", { scope: "/" }));
}

export default function PushCard() {
  const { t } = useI18n();
  const { family, setFamily } = useFamily();
  const [state, setState] = useState<"loading" | "unsupported" | "off" | "on" | "denied">("loading");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const p = t.settings.push;
  const familyId = family?.id ?? "";
  const ids = family?.pushIds ?? [];
  const idsKey = ids.join(",");

  useEffect(() => {
    let live = true;
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported" as const;
      if (Notification.permission === "denied") return "denied" as const;
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (!sub) return "off" as const;
      if (ids.includes(await shortHash(sub.endpoint))) return "on" as const;
      // Left over from another family on this device: end it, so that family stops reaching this phone.
      await sub.unsubscribe().catch(() => undefined);
      return "off" as const;
    })()
      .then((s) => live && setState(s))
      .catch(() => live && setState("unsupported"));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyId, idsKey]);

  if (!family?.pushKey) return null;

  async function enable() {
    if (!family?.pushKey) return;
    setBusy(true);
    setNote(null);
    try {
      if ((await Notification.requestPermission()) !== "granted") {
        setState("denied");
        return;
      }
      const reg = await registration();
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(family.pushKey) }));
      setFamily((await api.pushSubscribe(sub.toJSON())).family);
      setState("on");
    } catch {
      setNote(p.error);
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setNote(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await sub.unsubscribe();
        setFamily((await api.pushUnsubscribe(sub.endpoint)).family);
      }
      setState("off");
    } catch {
      setNote(p.error);
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    try {
      const res = await api.pushTest();
      setNote(res.sent > 0 ? p.tested : p.error);
    } catch {
      setNote(p.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="push" className={`${CARD} mt-4`}>
      <h2 className="font-semibold">{p.title}</h2>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{p.body}</p>
      {state === "unsupported" && <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{p.unsupported}</p>}
      {state === "denied" && <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">{p.denied}</p>}
      {state === "off" && (
        <button type="button" className={`${BTN_PRIMARY} mt-3`} disabled={busy} onClick={enable}>
          {p.on}
        </button>
      )}
      {state === "on" && (
        <>
          <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-300">{p.enabled}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={test}>
              {p.test}
            </button>
            <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={disable}>
              {p.off}
            </button>
          </div>
        </>
      )}
      {note && (
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400" role="status">
          {note}
        </p>
      )}
    </section>
  );
}

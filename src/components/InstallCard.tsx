"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { FLAG_INSTALLED, isInstalled, platformOf, writeFlag, type Platform } from "@/lib/setup";
import { BTN_PRIMARY, CARD } from "@/lib/ui";

// "Add to home screen". Android and desktop Chrome hand us an install prompt (captured
// in the layout before this component mounts); the iPhone needs two taps in Safari that
// no page can trigger, so the steps are spelled out.

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
declare global {
  interface Window {
    __pdInstallPrompt?: InstallPrompt;
  }
}

export default function InstallCard({ onInstalled }: { onInstalled?: (installed: boolean) => void }) {
  const { t } = useI18n();
  const [platform, setPlatform] = useState<Platform>("other");
  const [installed, setInstalled] = useState(false);
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading the device once
    setPlatform(platformOf(navigator.userAgent, navigator.maxTouchPoints));
    const done = isInstalled();
    setInstalled(done);
    onInstalled?.(done);
    setPrompt(window.__pdInstallPrompt ?? null);
    const onReady = () => setPrompt(window.__pdInstallPrompt ?? null);
    const onDone = () => {
      writeFlag(FLAG_INSTALLED);
      setInstalled(true);
      onInstalled?.(true);
    };
    window.addEventListener("pd-installable", onReady);
    window.addEventListener("appinstalled", onDone);
    return () => {
      window.removeEventListener("pd-installable", onReady);
      window.removeEventListener("appinstalled", onDone);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function install() {
    if (!prompt) return;
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === "accepted") {
        writeFlag(FLAG_INSTALLED);
        setInstalled(true);
        onInstalled?.(true);
      }
    } catch {
      /* the browser refused to show it again */
    } finally {
      window.__pdInstallPrompt = undefined;
      setPrompt(null);
    }
  }

  return (
    <section id="install" className={`${CARD} mt-4`}>
      <h2 className="font-semibold">{t.settings.setup.stepInstall}</h2>
      {installed ? (
        <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-300">{t.settings.setup.installed}</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{t.settings.setup.installBody}</p>
          {prompt && (
            <button type="button" className={`${BTN_PRIMARY} mt-3`} onClick={install}>
              {t.settings.setup.install}
            </button>
          )}
          <p className="mt-3 text-sm text-zinc-700 dark:text-zinc-300">{platform === "apple" ? t.settings.setup.installIos : platform === "android" ? t.settings.setup.installAndroid : t.settings.setup.installOther}</p>
          {platform !== "apple" && (
            <details className="mt-2 text-xs text-zinc-500">
              <summary className="cursor-pointer">{t.settings.setup.calOther}</summary>
              <p className="mt-1">{t.settings.setup.installIos}</p>
              <p className="mt-1">{platform === "android" ? t.settings.setup.installOther : t.settings.setup.installAndroid}</p>
            </details>
          )}
        </>
      )}
    </section>
  );
}

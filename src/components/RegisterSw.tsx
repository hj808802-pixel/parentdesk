"use client";

import { useEffect } from "react";

// Registers public/sw.js in production so the app can be installed on a phone's home
// screen (Android then offers ParentDesk in every app's Share menu). Nothing is cached.
export default function RegisterSw() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
  }, []);
  return null;
}

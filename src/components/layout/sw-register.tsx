"use client";

import * as React from "react";
import { syncNow } from "@/lib/sync/sync-engine";

export function ServiceWorkerRegister() {
  React.useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return; // im Dev nicht registrieren
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.error("[sw] registration failed", err);
    });

    const onMessage = (ev: MessageEvent) => {
      if (ev.data?.type === "sync-now") void syncNow();
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, []);
  return null;
}

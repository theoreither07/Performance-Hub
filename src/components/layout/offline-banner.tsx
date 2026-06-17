"use client";

import * as React from "react";
import { WifiOff } from "lucide-react";

/**
 * Offline-Banner mit AKTIVEM Connectivity-Check.
 *
 * navigator.onLine ist notorisch unzuverlaessig (PWA/iOS melden oft faelschlich offline).
 * Wir zeigen das Banner daher NUR wenn ein echter Health-Check fehlschlaegt — und
 * verifizieren bei jedem online/offline-Event + periodisch erneut.
 */
async function ping(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch("/api/health", { cache: "no-store", signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

export function OfflineBanner() {
  const [offline, setOffline] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    let consecutiveFails = 0;

    const check = async () => {
      const ok = await ping();
      if (cancelled) return;
      if (ok) {
        consecutiveFails = 0;
        setOffline(false);
      } else {
        // Erst nach 2 fehlgeschlagenen Checks als offline markieren (vermeidet Flackern)
        consecutiveFails += 1;
        if (consecutiveFails >= 2) setOffline(true);
      }
    };

    // Initial-Check
    check();
    // Bei Browser-Events erneut verifizieren (nicht blind glauben)
    const onChange = () => check();
    window.addEventListener("online", onChange);
    window.addEventListener("offline", onChange);
    // Periodischer Heartbeat alle 30s
    const id = setInterval(check, 30_000);

    return () => {
      cancelled = true;
      window.removeEventListener("online", onChange);
      window.removeEventListener("offline", onChange);
      clearInterval(id);
    };
  }, []);

  if (!offline) return null;
  return (
    <div className="bg-amber-500/15 border-b border-amber-500/30 text-amber-200 px-4 py-2 text-sm flex items-center gap-2">
      <WifiOff className="h-4 w-4" />
      Offline-Modus aktiv. Aenderungen werden gespeichert und synchronisiert sobald du wieder online bist.
    </div>
  );
}

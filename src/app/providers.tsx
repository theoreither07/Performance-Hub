"use client";

import * as React from "react";
import { SessionProvider } from "next-auth/react";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { get, set, del, createStore } from "idb-keyval";
import { startAutoSync } from "@/lib/sync/sync-engine";
import { ServiceWorkerRegister } from "@/components/layout/sw-register";
import { ToastProvider } from "@/components/ui/toast";

// Persister auf IndexedDB (idb-keyval).
const QUERY_STORE = createStore("dashboard-query-cache", "queries");

const idbPersister = {
  persistClient: async (client: unknown) => {
    try {
      await set("queries", client, QUERY_STORE);
    } catch {}
  },
  restoreClient: async () => {
    try {
      return (await get("queries", QUERY_STORE)) as never;
    } catch {
      return undefined;
    }
  },
  removeClient: async () => {
    try {
      await del("queries", QUERY_STORE);
    } catch {}
  },
};

// Buster wird bei jedem Deploy hochgezaehlt — invalidiert IDB-Cache komplett.
// Wichtig: bumpen wenn API-Schema sich aendert oder UI weird hangs hat.
const CACHE_BUSTER = "v98";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Cache 60s als "fresh", dann stale (refetch on next mount). Verhindert refetch-Sturm.
            staleTime: 60_000,
            // gcTime: 1h. Vorher 24h → zu lange. Cache-Schwergewicht im Speicher.
            gcTime: 60 * 60_000,
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
            retry: 1,
            // refetchOnMount: true (Default) — nicht "always" (wuerde JEDEN Mount refetchen).
            refetchOnMount: true,
          },
        },
      }),
  );

  React.useEffect(() => {
    const stop = startAutoSync(30_000);
    return stop;
  }, []);

  // Auto-Reload wenn Service Worker neue Version installiert.
  React.useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onControllerChange = () => {
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    return () => navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
  }, []);

  return (
    <SessionProvider>
      <PersistQueryClientProvider
        client={client}
        persistOptions={{
          persister: idbPersister,
          maxAge: 60 * 60_000, // 1h
          buster: CACHE_BUSTER,
        }}
      >
        <ServiceWorkerRegister />
        <ToastProvider>{children}</ToastProvider>
      </PersistQueryClientProvider>
    </SessionProvider>
  );
}

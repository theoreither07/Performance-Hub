"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { haptics } from "@/lib/ui/haptics";
import { useToast } from "@/components/ui/toast";

/**
 * Sticky Sync-Button — bottom-right, ueber der Tab-Bar.
 * - Idle: gruener Kreis mit Refresh-Icon
 * - Pending: spinner
 * - Success: kurz Check-Icon, dann zurueck zu idle, + Haptic success
 *
 * Triggert /api/sync/refresh-all (Garmin + Health-Context-Invalidate)
 * und purged danach SW-Cache + invalidiert React-Query-Caches.
 */
export function SyncFab() {
  const qc = useQueryClient();
  const toast = useToast();
  const [showCheck, setShowCheck] = React.useState(false);

  const sync = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/sync/refresh-all", { method: "POST" });
      if (!res.ok) throw new Error("sync failed");
      return res.json();
    },
    onSuccess: () => {
      haptics.success();
      toast.success("Sync gestartet", "Daten kommen in ~15-30 Sek.");
      setShowCheck(true);
      setTimeout(() => setShowCheck(false), 1500);
      // Garmin braucht ~15s im Hintergrund — danach Caches leeren
      setTimeout(() => {
        if (typeof navigator !== "undefined" && navigator.serviceWorker?.controller) {
          navigator.serviceWorker.controller.postMessage({ type: "purge-health-cache" });
        }
        qc.invalidateQueries({ queryKey: ["health-metrics"] });
        qc.invalidateQueries({ queryKey: ["health-score"] });
        qc.invalidateQueries({ queryKey: ["coach-recommendation"] });
      }, 15_000);
    },
    onError: () => {
      haptics.warn();
      toast.error("Sync-Fehler", "Versuch's gleich nochmal.");
    },
  });

  return (
    <button
      type="button"
      onClick={() => sync.mutate()}
      disabled={sync.isPending}
      aria-label="Garmin Sync"
      className={cn(
        "fixed z-30",
        "right-4 bottom-[calc(env(safe-area-inset-bottom)+76px)]",
        "sm:bottom-6 sm:right-6",
        "h-14 w-14 rounded-full shadow-lg shadow-primary/20",
        "bg-primary text-primary-foreground",
        "flex items-center justify-center",
        "transition-all duration-200 active:scale-90",
        "hover:shadow-xl hover:shadow-primary/30",
        "disabled:opacity-90",
      )}
    >
      {showCheck ? (
        <Check className="h-6 w-6 animate-fade-slide-in" />
      ) : (
        <RefreshCw className={cn("h-6 w-6", sync.isPending && "animate-spin")} />
      )}
    </button>
  );
}

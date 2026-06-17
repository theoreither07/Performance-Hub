"use client";

import * as React from "react";
import { haptics } from "@/lib/ui/haptics";

interface UsePullRefreshOpts {
  onRefresh: () => void | Promise<void>;
  threshold?: number; // px
  resistance?: number; // ziehbar-Faktor (>1 = mehr Widerstand)
  enabled?: boolean;
}

/**
 * Pull-to-Refresh fuer mobile PWAs. iOS-Safari blockiert overscroll-Verhalten,
 * deshalb arbeiten wir mit reinen Touch-Events.
 *
 * Liefert:
 *  - bind: spread auf das Scrollkontainer-DIV
 *  - pullPx: aktueller Pull-Wert (0 bei Idle)
 *  - state: "idle" | "pulling" | "ready" | "refreshing"
 *
 * Trigger: ueberschreitet der User threshold, vibriert das Geraet einmal
 * (haptics.pull()). Beim Loslassen oberhalb threshold ruft onRefresh().
 */
export function usePullRefresh({
  onRefresh,
  threshold = 72,
  resistance = 2.4,
  enabled = true,
}: UsePullRefreshOpts) {
  const [pullPx, setPullPx] = React.useState(0);
  const [state, setState] = React.useState<"idle" | "pulling" | "ready" | "refreshing">("idle");
  const startY = React.useRef<number | null>(null);
  const armedAtTop = React.useRef(false);
  const triggeredVibrate = React.useRef(false);

  const onTouchStart = React.useCallback((e: React.TouchEvent) => {
    if (!enabled) return;
    if (state === "refreshing") return;
    // Nur am Scroll-Top arbeiten
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    if (scrollTop > 0) {
      armedAtTop.current = false;
      return;
    }
    armedAtTop.current = true;
    startY.current = e.touches[0]?.clientY ?? null;
    triggeredVibrate.current = false;
  }, [enabled, state]);

  const onTouchMove = React.useCallback((e: React.TouchEvent) => {
    if (!enabled || !armedAtTop.current || startY.current == null) return;
    if (state === "refreshing") return;
    const dy = (e.touches[0]?.clientY ?? 0) - startY.current;
    if (dy <= 0) {
      setPullPx(0);
      setState("idle");
      return;
    }
    const damped = dy / resistance;
    setPullPx(damped);
    if (damped > threshold) {
      if (!triggeredVibrate.current) {
        haptics.pull();
        triggeredVibrate.current = true;
      }
      setState("ready");
    } else {
      setState("pulling");
    }
  }, [enabled, state, resistance, threshold]);

  const onTouchEnd = React.useCallback(async () => {
    if (!enabled || !armedAtTop.current) return;
    armedAtTop.current = false;
    if (state === "ready") {
      setState("refreshing");
      try {
        await onRefresh();
      } finally {
        setPullPx(0);
        setState("idle");
      }
    } else {
      setPullPx(0);
      setState("idle");
    }
  }, [enabled, state, onRefresh]);

  return {
    bind: { onTouchStart, onTouchMove, onTouchEnd },
    pullPx,
    state,
  };
}

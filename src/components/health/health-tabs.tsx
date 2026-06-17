"use client";

import * as React from "react";
import { Activity, Calendar, LineChart, User } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { haptics } from "@/lib/ui/haptics";

export type HealthTab = "heute" | "trends" | "plan" | "profil";

export const HEALTH_TABS: { id: HealthTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "heute", label: "Heute", icon: Activity },
  { id: "trends", label: "Trends", icon: LineChart },
  { id: "plan", label: "Plan", icon: Calendar },
  { id: "profil", label: "Profil", icon: User },
];

interface HealthTabsProps {
  active: HealthTab;
  onChange: (tab: HealthTab) => void;
}

/**
 * Bottom-Tab-Bar fuer den Health-Bereich. Sticky am unteren Rand, sicher gegen iOS-Safe-Area.
 * Tab-Wechsel triggert View-Transitions-API (smooth fade), und gibt Haptic-Feedback.
 */
export function HealthTabs({ active, onChange }: HealthTabsProps) {
  const handleChange = (tab: HealthTab) => {
    if (tab === active) return;
    haptics.tap();
    // View Transitions API — Browser-native smooth crossfade
    type WithViewTransition = Document & { startViewTransition?: (cb: () => void) => unknown };
    const doc = document as WithViewTransition;
    if (typeof doc.startViewTransition === "function") {
      doc.startViewTransition(() => onChange(tab));
    } else {
      onChange(tab);
    }
  };

  return (
    <nav
      className={cn(
        "fixed bottom-0 left-0 right-0 z-30",
        "border-t border-border/40 bg-card/95 backdrop-blur-md",
        "pb-[max(env(safe-area-inset-bottom),0px)]",
        "sm:hidden", // Desktop hat eigene Nav, Tabs nur Mobile
      )}
      aria-label="Health-Bereiche"
    >
      <ul className="flex items-stretch justify-around">
        {HEALTH_TABS.map((t) => {
          const Icon = t.icon;
          const isActive = active === t.id;
          return (
            <li key={t.id} className="flex-1">
              <button
                type="button"
                onClick={() => handleChange(t.id)}
                className={cn(
                  "flex w-full flex-col items-center gap-0.5 py-2.5 transition-colors",
                  "focus:outline-none focus:ring-2 focus:ring-primary/60",
                  isActive ? "text-primary" : "text-muted-foreground",
                )}
                aria-current={isActive ? "page" : undefined}
              >
                <Icon className={cn("h-5 w-5", isActive && "stroke-[2.5]")} />
                <span className="text-[10px] uppercase tracking-wider">{t.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Desktop-Variante: horizontale Tabs (sm+). Wird ueber dem Content gerendert.
 */
export function HealthTabsDesktop({ active, onChange }: HealthTabsProps) {
  const handleChange = (tab: HealthTab) => {
    if (tab === active) return;
    haptics.tap();
    type WithViewTransition = Document & { startViewTransition?: (cb: () => void) => unknown };
    const doc = document as WithViewTransition;
    if (typeof doc.startViewTransition === "function") {
      doc.startViewTransition(() => onChange(tab));
    } else {
      onChange(tab);
    }
  };

  return (
    <div className="hidden sm:flex items-center gap-1 border-b border-border/40 -mt-2">
      {HEALTH_TABS.map((t) => {
        const Icon = t.icon;
        const isActive = active === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => handleChange(t.id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-sm transition-colors relative",
              isActive
                ? "text-foreground font-semibold"
                : "text-muted-foreground hover:text-foreground",
            )}
            aria-current={isActive ? "page" : undefined}
          >
            <Icon className="h-4 w-4" />
            {t.label}
            {isActive && (
              <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-primary rounded-full" />
            )}
          </button>
        );
      })}
    </div>
  );
}

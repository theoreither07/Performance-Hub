"use client";

import * as React from "react";
import { Plus, RefreshCw, Check } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { QuickAddDialog } from "@/components/dashboard/quick-add-dialog";
import { MobileMenuButton } from "./mobile-nav";
import { syncNow } from "@/lib/sync/sync-engine";
import { format } from "date-fns";
import { de } from "@/lib/i18n/date-locale";
import { cn } from "@/lib/utils/cn";

export function TopBar() {
  const qc = useQueryClient();
  const [now, setNow] = React.useState<Date>(new Date());
  const [syncing, setSyncing] = React.useState(false);
  const [justSynced, setJustSynced] = React.useState(false);
  const [quickOpen, setQuickOpen] = React.useState(false);

  React.useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setQuickOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onRefreshAll = async () => {
    setSyncing(true);
    try {
      // 1. Lokale Sync-Engine (Outbox push/pull fuer Todos/Projects)
      await syncNow().catch(() => undefined);
      // 2. Externe Datenquellen anstossen (Garmin via Trigger-File)
      await fetch("/api/sync/refresh-all", { method: "POST" }).catch(() => undefined);
      // 3. Alle TanStack-Queries invalidieren → Calendar, Mail, Health, Habits, Coach etc.
      await qc.invalidateQueries();
      setJustSynced(true);
      setTimeout(() => setJustSynced(false), 2000);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-md safe-top">
      <div className="flex h-14 items-center gap-2 px-3 lg:px-8">
        <MobileMenuButton />
        <div className="hidden md:block">
          <p className="text-sm font-medium leading-none">
            {format(now, "EEEE, d. MMMM", { locale: de })}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">{format(now, "HH:mm")} Uhr</p>
        </div>
        <div className="lg:hidden">
          <p className="text-sm font-semibold leading-none">
            {format(now, "EEE, d. MMM", { locale: de })}
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">{format(now, "HH:mm")}</p>
        </div>
        <div className="flex items-center gap-1 ml-auto">
          <Button
            variant="ghost"
            size="icon"
            onClick={onRefreshAll}
            disabled={syncing}
            aria-label="Alles neu laden (Garmin, Kalender, Mail, Todos)"
            title="Alle Daten neu laden"
          >
            {justSynced ? (
              <Check className="h-4 w-4 text-emerald-400" />
            ) : (
              <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} />
            )}
          </Button>
          <Button onClick={() => setQuickOpen(true)} size="sm" className="gap-1.5">
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Neu</span>
            <kbd className="hidden md:inline ml-1 text-[10px] opacity-70">&#8984;K</kbd>
          </Button>
        </div>
      </div>
      <QuickAddDialog open={quickOpen} onOpenChange={setQuickOpen} />
    </header>
  );
}

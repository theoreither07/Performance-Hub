"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Filter, RefreshCw } from "lucide-react";

interface CalendarItem {
  id: string;
  calendarId: string;
  summary: string;
  backgroundColor: string | null;
  primary: boolean;
  enabled: boolean;
  accountEmail: string;
  accountKind: "PRIVATE" | "BUSINESS";
}

export function CalendarFilter() {
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);

  const { data, isLoading } = useQuery<{ calendars: CalendarItem[] }>({
    queryKey: ["calendars-list"],
    queryFn: async () => {
      const res = await fetch("/api/calendar/calendars");
      if (!res.ok) throw new Error("calendars");
      return res.json();
    },
    staleTime: 60_000,
  });

  const [syncing, setSyncing] = React.useState(false);

  const triggerSync = async () => {
    setSyncing(true);
    try {
      await fetch("/api/calendar/calendars?sync=1");
      await qc.invalidateQueries({ queryKey: ["calendars-list"] });
      await qc.invalidateQueries({ queryKey: ["calendar-week"] });
      await qc.invalidateQueries({ queryKey: ["calendar-today"] });
    } finally {
      setSyncing(false);
    }
  };

  const toggleCalendar = async (id: string, enabled: boolean) => {
    // Optimistic update
    qc.setQueryData<{ calendars: CalendarItem[] }>(["calendars-list"], (old) => {
      if (!old) return old;
      return {
        calendars: old.calendars.map((c) => (c.id === id ? { ...c, enabled } : c)),
      };
    });
    await fetch("/api/calendar/calendars", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ updates: [{ id, enabled }] }),
    });
    await qc.invalidateQueries({ queryKey: ["calendar-week"] });
    await qc.invalidateQueries({ queryKey: ["calendar-today"] });
  };

  if (isLoading || !data) return null;
  if (data.calendars.length === 0) return null;

  const enabledCount = data.calendars.filter((c) => c.enabled).length;
  const grouped: Record<string, CalendarItem[]> = {};
  for (const cal of data.calendars) {
    grouped[cal.accountEmail] = grouped[cal.accountEmail] ?? [];
    grouped[cal.accountEmail].push(cal);
  }

  return (
    <Card>
      <CardContent className="py-3">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-2 text-sm font-medium hover:text-primary transition-colors"
          >
            <Filter className="h-4 w-4" />
            Kalender filtern
            <span className="text-xs text-muted-foreground font-normal">
              ({enabledCount} von {data.calendars.length} aktiv)
            </span>
          </button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={triggerSync}
            disabled={syncing}
            className="h-7 gap-1.5"
          >
            <RefreshCw className={syncing ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
            <span className="text-xs">Sync</span>
          </Button>
        </div>

        {open && (
          <div className="mt-4 space-y-4">
            {Object.entries(grouped).map(([email, cals]) => (
              <div key={email}>
                <p className="text-xs font-medium text-muted-foreground mb-2">{email}</p>
                <div className="space-y-1.5">
                  {cals.map((cal) => (
                    <label
                      key={cal.id}
                      className="flex items-center gap-2.5 py-1 px-2 rounded-md hover:bg-accent/50 cursor-pointer"
                    >
                      <Checkbox
                        checked={cal.enabled}
                        onCheckedChange={(v) => void toggleCalendar(cal.id, Boolean(v))}
                      />
                      {cal.backgroundColor && (
                        <span
                          className="h-2.5 w-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: cal.backgroundColor }}
                        />
                      )}
                      <span className="text-sm flex-1 truncate">{cal.summary}</span>
                      {cal.primary && (
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                          Primary
                        </span>
                      )}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

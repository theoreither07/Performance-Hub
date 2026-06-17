"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import type { CalendarEvent } from "@/types/domain";
import { CalendarConnectCTA } from "@/components/calendar/connect-cta";

export function CalendarTodayWidget() {
  const { data, isLoading, error } = useQuery<{ events: CalendarEvent[] }>({
    queryKey: ["calendar-today"],
    queryFn: async () => {
      const res = await fetch("/api/calendar/today");
      if (!res.ok) throw new Error("calendar");
      return res.json();
    },
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Termine heute</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading && <p className="text-sm text-muted-foreground">Laden...</p>}
        {(error || data?.events.length === 0) && (
          <CalendarConnectCTA compact />
        )}
        {data?.events.map((ev) => (
          <div key={ev.id} className="flex items-start gap-3 py-1.5">
            <div className="w-12 text-xs text-muted-foreground pt-0.5">
              {ev.allDay ? "Ganzt." : format(new Date(ev.start), "HH:mm")}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{ev.title}</p>
              {ev.location && <p className="text-xs text-muted-foreground truncate">{ev.location}</p>}
            </div>
            <Badge variant={ev.accountKind === "PRIVATE" ? "priv" : "biz"}>
              {ev.accountKind === "PRIVATE" ? "Privat" : "Biz"}
            </Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

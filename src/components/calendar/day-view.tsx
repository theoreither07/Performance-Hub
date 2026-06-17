"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sun, Briefcase, Clock } from "lucide-react";
import { format, isWithinInterval } from "date-fns";
import { de } from "@/lib/i18n/date-locale";
import type { CalendarEvent } from "@/types/domain";

export function DayView({ date, events }: { date: Date; events: CalendarEvent[] }) {
  const businessEvents = events.filter((e) => e.accountKind === "BUSINESS");
  const privateEvents = events.filter((e) => e.accountKind === "PRIVATE");
  const allDay = events.filter((e) => e.allDay);
  const timed = events.filter((e) => !e.allDay).sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  // Aktuelle Stunde fuer "now-Linie"
  const now = new Date();
  const isToday = isWithinInterval(now, {
    start: new Date(date.setHours(0, 0, 0, 0)),
    end: new Date(date.setHours(23, 59, 59, 999)),
  });

  return (
    <div className="space-y-4">
      {businessEvents.length > 0 && (
        <Card className="border-brand-lime/30 bg-brand-lime/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Briefcase className="h-4 w-4 text-brand-lime" />
              Business heute
              <span className="text-xs text-muted-foreground font-normal ml-auto">
                {businessEvents.length} Termine
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {businessEvents.map((ev) => (
              <div key={ev.id} className="flex items-start gap-3 py-1">
                <div className="w-14 text-xs text-muted-foreground pt-0.5 tabular-nums">
                  {ev.allDay ? "Ganzt." : format(new Date(ev.start), "HH:mm")}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{ev.title}</p>
                  {ev.location && (
                    <p className="text-xs text-muted-foreground truncate">{ev.location}</p>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Alle Termine
            <span className="text-xs text-muted-foreground font-normal ml-auto">
              {events.length} gesamt
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {events.length === 0 && (
            <p className="text-sm text-muted-foreground py-6 text-center">
              {isToday ? "Heute" : "An diesem Tag"} keine Termine.
            </p>
          )}
          {allDay.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {allDay.map((ev) => (
                <div
                  key={ev.id}
                  className={
                    ev.accountKind === "BUSINESS"
                      ? "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs bg-brand-lime/15 text-brand-lime border border-brand-lime/30"
                      : "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs bg-priv/15 text-priv border border-priv/30"
                  }
                >
                  <Sun className="h-3 w-3" />
                  <span className="font-medium">{ev.title}</span>
                </div>
              ))}
            </div>
          )}
          {timed.map((ev) => (
            <div key={ev.id} className="flex items-start gap-3 py-1.5 border-b border-border/30 last:border-0">
              <div className="w-14 text-xs text-muted-foreground pt-0.5 tabular-nums">
                {format(new Date(ev.start), "HH:mm")}
                <div className="text-[10px] opacity-60">
                  bis {format(new Date(ev.end), "HH:mm")}
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{ev.title}</p>
                {ev.location && (
                  <p className="text-xs text-muted-foreground truncate">{ev.location}</p>
                )}
              </div>
              <Badge variant={ev.accountKind === "PRIVATE" ? "priv" : "biz"}>
                {ev.accountKind === "PRIVATE" ? "Privat" : "Business"}
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      {privateEvents.length > 0 && businessEvents.length > 0 && (
        <p className="text-xs text-muted-foreground text-center">
          {privateEvents.length} private + {businessEvents.length} business Termine
        </p>
      )}
    </div>
  );
}

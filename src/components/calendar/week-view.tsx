"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sun } from "lucide-react";
import { format, isSameDay, isToday } from "date-fns";
import { de } from "@/lib/i18n/date-locale";
import type { CalendarEvent } from "@/types/domain";
import { cn } from "@/lib/utils/cn";

export function WeekView({ events, days }: { events: CalendarEvent[]; days: Date[] }) {
  return (
    <div className="space-y-3">
      {days.map((day) => {
        const dayEvents = events.filter((ev) => isSameDay(new Date(ev.start), day));
        const allDay = dayEvents.filter((e) => e.allDay);
        const timed = dayEvents
          .filter((e) => !e.allDay)
          .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
        const today = isToday(day);
        return (
          <Card key={day.toISOString()} className={cn(today && "ring-1 ring-primary/40")}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                {format(day, "EEEE, d. MMMM", { locale: de })}
                {today && <Badge variant="biz" className="text-[10px]">Heute</Badge>}
                <span className="text-xs text-muted-foreground font-normal ml-auto">
                  {dayEvents.length === 0 ? "frei" : `${dayEvents.length} Termine`}
                </span>
              </CardTitle>
            </CardHeader>
            {dayEvents.length > 0 && (
              <CardContent className="space-y-3">
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
                {timed.length > 0 && (
                  <div className="space-y-1">
                    {timed.map((ev) => (
                      <div key={ev.id} className="flex items-start gap-3 py-1">
                        <div className="w-14 text-xs text-muted-foreground pt-0.5 tabular-nums">
                          {format(new Date(ev.start), "HH:mm")}
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
                  </div>
                )}
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}

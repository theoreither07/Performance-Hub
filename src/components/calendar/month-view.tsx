"use client";

import * as React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  isToday,
} from "date-fns";
import { de } from "@/lib/i18n/date-locale";
import type { CalendarEvent } from "@/types/domain";
import { cn } from "@/lib/utils/cn";

export function MonthView({ events, anchor }: { events: CalendarEvent[]; anchor: Date }) {
  const monthStart = startOfMonth(anchor);
  const monthEnd = endOfMonth(anchor);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  const [selectedDay, setSelectedDay] = React.useState<Date | null>(null);

  const byDay: Record<string, CalendarEvent[]> = {};
  for (const ev of events) {
    const key = format(new Date(ev.start), "yyyy-MM-dd");
    byDay[key] = byDay[key] ?? [];
    byDay[key].push(ev);
  }

  const weekdays = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
  const selectedEvents = selectedDay ? byDay[format(selectedDay, "yyyy-MM-dd")] ?? [] : [];

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-3">
          <div className="grid grid-cols-7 gap-1">
            {weekdays.map((wd) => (
              <div key={wd} className="text-[10px] uppercase tracking-wider text-muted-foreground text-center pb-2">
                {wd}
              </div>
            ))}
            {days.map((day) => {
              const key = format(day, "yyyy-MM-dd");
              const dayEvents = byDay[key] ?? [];
              const inMonth = isSameMonth(day, anchor);
              const today = isToday(day);
              const selected = selectedDay && isSameDay(selectedDay, day);
              const hasBusiness = dayEvents.some((e) => e.accountKind === "BUSINESS");
              const hasPrivate = dayEvents.some((e) => e.accountKind === "PRIVATE");
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedDay(day)}
                  className={cn(
                    "aspect-square rounded-md p-1.5 text-left transition-colors relative flex flex-col",
                    !inMonth && "opacity-30",
                    today && "ring-1 ring-primary",
                    selected && "bg-primary/15",
                    !selected && "hover:bg-accent/40",
                  )}
                >
                  <span className={cn("text-xs", today && "font-bold text-primary")}>
                    {format(day, "d")}
                  </span>
                  <div className="flex-1 flex items-end justify-start gap-0.5 flex-wrap">
                    {hasBusiness && (
                      <span className="h-1.5 w-1.5 rounded-full bg-brand-lime" />
                    )}
                    {hasPrivate && (
                      <span className="h-1.5 w-1.5 rounded-full bg-priv" />
                    )}
                    {dayEvents.length > 2 && (
                      <span className="text-[8px] text-muted-foreground">
                        +{dayEvents.length}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {selectedDay && (
        <Card>
          <CardContent className="py-4 space-y-2">
            <p className="text-sm font-medium">
              {format(selectedDay, "EEEE, d. MMMM", { locale: de })}
            </p>
            {selectedEvents.length === 0 && (
              <p className="text-sm text-muted-foreground">Keine Termine.</p>
            )}
            {selectedEvents
              .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
              .map((ev) => (
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
                  <Badge variant={ev.accountKind === "PRIVATE" ? "priv" : "biz"}>
                    {ev.accountKind === "PRIVATE" ? "Privat" : "Business"}
                  </Badge>
                </div>
              ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  addDays,
  addWeeks,
  addMonths,
  eachDayOfInterval,
  format,
  isSameDay,
} from "date-fns";
import { de } from "@/lib/i18n/date-locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CalendarEvent } from "@/types/domain";
import { CalendarConnectCTA } from "@/components/calendar/connect-cta";
import { CalendarFilter } from "@/components/calendar/calendar-filter";
import { DayView } from "@/components/calendar/day-view";
import { WeekView } from "@/components/calendar/week-view";
import { MonthView } from "@/components/calendar/month-view";
import { PageHeader } from "@/components/layout/page-header";

type View = "day" | "week" | "month";

function rangeFor(view: View, anchor: Date): { from: Date; to: Date; title: string } {
  if (view === "day") {
    return {
      from: startOfDay(anchor),
      to: endOfDay(anchor),
      title: format(anchor, "EEEE, d. MMMM yyyy", { locale: de }),
    };
  }
  if (view === "week") {
    const from = startOfWeek(anchor, { weekStartsOn: 1 });
    const to = endOfWeek(anchor, { weekStartsOn: 1 });
    return {
      from,
      to,
      title: `${format(from, "d. MMM", { locale: de })} – ${format(to, "d. MMM yyyy", { locale: de })}`,
    };
  }
  // month
  const monthStart = startOfMonth(anchor);
  const monthEnd = endOfMonth(anchor);
  return {
    from: startOfWeek(monthStart, { weekStartsOn: 1 }),
    to: endOfWeek(monthEnd, { weekStartsOn: 1 }),
    title: format(anchor, "MMMM yyyy", { locale: de }),
  };
}

/**
 * Wochenansicht startet immer bei HEUTE und zeigt bis Sonntag der aktuellen Woche.
 * Vergangene Tage der Woche werden ausgeblendet (bewusste Design-Entscheidung).
 */
function weekFromToday(anchor: Date): { from: Date; to: Date; title: string } {
  const today = startOfDay(new Date());
  const weekStart = startOfWeek(anchor, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(anchor, { weekStartsOn: 1 });
  const isCurrentWeek = today >= weekStart && today <= weekEnd;
  const from = isCurrentWeek ? today : weekStart;
  return {
    from,
    to: weekEnd,
    title: isCurrentWeek
      ? `Heute – ${format(weekEnd, "EEEE d. MMM", { locale: de })}`
      : `${format(weekStart, "d. MMM", { locale: de })} – ${format(weekEnd, "d. MMM yyyy", { locale: de })}`,
  };
}

export default function CalendarPage() {
  // Default: Tagesansicht heute.
  const [view, setView] = React.useState<View>("day");
  const [anchor, setAnchor] = React.useState<Date>(new Date());

  function handleViewChange(next: View) {
    setView(next);
    // Beim View-Wechsel zurueck zu heute
    if (next === "day" || next === "week") {
      setAnchor(new Date());
    }
  }

  const { from, to, title } = view === "week" ? weekFromToday(anchor) : rangeFor(view, anchor);

  const { data, isLoading } = useQuery<{ events: CalendarEvent[] }>({
    queryKey: ["calendar-range", from.toISOString(), to.toISOString()],
    queryFn: async () => {
      const res = await fetch(
        `/api/calendar/range?from=${from.toISOString()}&to=${to.toISOString()}`,
      );
      if (!res.ok) throw new Error("calendar");
      return res.json();
    },
    staleTime: 60_000,
  });

  const navigate = (dir: 1 | -1) => {
    if (view === "day") setAnchor((d) => addDays(d, dir));
    else if (view === "week") setAnchor((d) => addWeeks(d, dir));
    else setAnchor((d) => addMonths(d, dir));
  };

  const weekDays =
    view === "week"
      ? eachDayOfInterval({
          start: from,
          end: to,
        })
      : [];

  const events = data?.events ?? [];

  return (
    <div className="space-y-4">
      <PageHeader title="Kalender" subtitle="Termine aus deinem privaten Google-Kalender (Source of Truth) und optional einem Business-Konto." />

      <CalendarFilter />

      <Card>
        <CardContent className="py-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate(-1)} aria-label="Vorher">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8"
                onClick={() => setAnchor(new Date())}
              >
                Heute
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate(1)} aria-label="Naechster">
                <ChevronRight className="h-4 w-4" />
              </Button>
              <span className="text-sm font-medium ml-3">{title}</span>
            </div>
            <Tabs value={view} onValueChange={(v) => handleViewChange(v as View)}>
              <TabsList>
                <TabsTrigger value="day">Tag</TabsTrigger>
                <TabsTrigger value="week">Woche</TabsTrigger>
                <TabsTrigger value="month">Monat</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </CardContent>
      </Card>

      {isLoading && <p className="text-sm text-muted-foreground">Laden...</p>}
      {!isLoading && events.length === 0 && view !== "month" && <CalendarConnectCTA />}

      {view === "day" && <DayView date={anchor} events={events.filter((e) => isSameDay(new Date(e.start), anchor))} />}
      {view === "week" && <WeekView events={events} days={weekDays} />}
      {view === "month" && <MonthView events={events} anchor={anchor} />}
    </div>
  );
}

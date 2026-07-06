"use client";

/**
 * Daily Coach Briefing — aggregiert Coach-Output + Trainings + Tasks + Calendar + Watchouts.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle, Calendar as CalendarIcon, ChevronRight, Dumbbell, Footprints,
  ListTodo, Sparkles, Sunrise,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { de } from "@/lib/i18n/date-locale";
import Link from "next/link";
import { cn } from "@/lib/utils/cn";
import { PageHeader } from "@/components/layout/page-header";

interface Recommendation {
  generatedAt: string;
  phase: string | null;
  statusFocus: string | null;
  actionsNow: string | null;
  eveningPrep: string | null;
  tomorrowSetup: string | null;
  strengthIntensity: number | null;
  cardioIntensity: number | null;
  intensityReason: string | null;
  errorMessage: string | null;
}

interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  accountKind: "PRIVATE" | "BUSINESS";
  allDay: boolean;
}

interface Todo {
  id: string;
  title: string;
  completed: boolean;
  due?: string | null;
  priority?: number | null;
  projectId?: string | null;
}

function MarkdownMini({ text }: { text: string }) {
  const lines = text.split("\n").filter((l) => l.trim());
  return (
    <div className="space-y-1.5 text-sm">
      {lines.map((line, i) => {
        if (line.startsWith("### ")) {
          return <p key={i} className="text-xs uppercase tracking-wider text-primary/80 font-semibold mt-2"
            dangerouslySetInnerHTML={{ __html: formatBold(line.replace(/^### /, "")) }} />;
        }
        if (line.startsWith("## ")) return null;
        if (/^[-*]\s/.test(line)) {
          return <p key={i} className="text-foreground/90 pl-3 relative leading-relaxed"
            dangerouslySetInnerHTML={{ __html: `<span class="absolute left-0 text-primary">›</span> ${formatBold(line.replace(/^[-*]\s+/, ""))}` }} />;
        }
        return <p key={i} className="text-foreground/90 leading-relaxed"
          dangerouslySetInnerHTML={{ __html: formatBold(line) }} />;
      })}
    </div>
  );
}

function formatBold(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*([^*]+)\*\*/g, '<strong class="font-bold text-foreground">$1</strong>');
}

function timeRange(start: string, end: string): string {
  try {
    const s = parseISO(start), e = parseISO(end);
    return `${format(s, "HH:mm")}–${format(e, "HH:mm")}`;
  } catch {
    return "";
  }
}

export default function CoachPage() {
  const todayKey = format(new Date(), "yyyy-MM-dd");
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);

  // Auto-Mark "Coach-Briefing gelesen" für Morgens-Ritual — sobald User /coach besucht.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(`coach-briefing-read-${todayKey}`, "1");
    } catch {
      // localStorage könnte deaktiviert sein (Private-Mode etc.) — silent.
    }
  }, [todayKey]);

  const recoQ = useQuery<{ recommendation: Recommendation | null }>({
    queryKey: ["coach-recommendation", todayKey],
    queryFn: async () => {
      const res = await fetch("/api/coach/generate");
      if (!res.ok) throw new Error("reco");
      return res.json();
    },
    staleTime: 60_000,
  });

  const eventsQ = useQuery<{ events: CalendarEvent[] }>({
    queryKey: ["calendar-today-coach"],
    queryFn: async () => {
      const res = await fetch(`/api/calendar/range?from=${encodeURIComponent(startOfToday.toISOString())}&to=${encodeURIComponent(endOfToday.toISOString())}`);
      if (!res.ok) throw new Error("events");
      return res.json();
    },
    staleTime: 60_000,
  });

  const todosQ = useQuery<{ items: Todo[] }>({
    queryKey: ["todos-coach"],
    queryFn: async () => {
      const res = await fetch("/api/todos");
      if (!res.ok) throw new Error("todos");
      return res.json();
    },
    staleTime: 60_000,
  });

  const reco = recoQ.data?.recommendation ?? null;
  const events = (eventsQ.data?.events ?? []).filter((e) => !e.allDay);
  const allTodos = todosQ.data?.items ?? [];

  const topTodos = allTodos
    .filter((t) => !t.completed)
    .sort((a, b) => {
      const aDue = a.due && a.due.startsWith(todayKey) ? 0 : 1;
      const bDue = b.due && b.due.startsWith(todayKey) ? 0 : 1;
      if (aDue !== bDue) return aDue - bDue;
      return (a.priority ?? 99) - (b.priority ?? 99);
    })
    .slice(0, 5);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Daily Coach"
        subtitle={`${format(now, "EEEE, d. MMMM yyyy", { locale: de })} — was heute zu tun ist.`}
        actions={
          reco?.generatedAt && (
            <Badge variant="outline" className="text-[10px]">
              Briefing {format(parseISO(reco.generatedAt), "HH:mm")}
            </Badge>
          )
        }
      />

      {reco?.actionsNow ? (
        <Card className="border-primary/30 overflow-hidden">
          <CardContent className="p-4 space-y-2">
            <p className="text-[10px] uppercase tracking-wider text-primary font-semibold flex items-center gap-1.5">
              <Sunrise className="h-3 w-3" /> Aktion jetzt
            </p>
            <MarkdownMini text={reco.actionsNow.slice(0, 1500)} />
            {(reco.strengthIntensity !== null || reco.cardioIntensity !== null) && (
              <div className="flex flex-wrap gap-2 pt-2 border-t border-border/30">
                {reco.strengthIntensity !== null && (
                  <Badge variant="outline" className="gap-1">
                    <Dumbbell className="h-3 w-3" /> Kraft {reco.strengthIntensity}/10
                  </Badge>
                )}
                {reco.cardioIntensity !== null && (
                  <Badge variant="outline" className="gap-1">
                    <Footprints className="h-3 w-3" /> Cardio {reco.cardioIntensity}/10
                  </Badge>
                )}
                {reco.intensityReason && (
                  <span className="text-xs text-muted-foreground italic self-center">{reco.intensityReason}</span>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      ) : recoQ.isLoading ? (
        <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Lade Coach-Briefing...</p></CardContent></Card>
      ) : (
        <Card className="border-amber-500/30">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 text-amber-300 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-medium">Noch kein Briefing für heute</p>
              <p className="text-xs text-muted-foreground">
                Warte auf den Auto-Cron um 07:00 oder triggere via <Link href="/health" className="text-primary underline">/health</Link>.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarIcon className="h-4 w-4 text-primary" /> Heute im Kalender
            <Badge variant="outline" className="text-[10px] ml-auto">{events.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {events.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">Kein Termin heute. Du bist frei.</p>
          ) : (
            events.slice(0, 8).map((e) => (
              <div key={e.id} className="flex items-start gap-2 text-xs py-1.5 border-t border-border/30 first:border-t-0">
                <span className="tabular-nums text-muted-foreground w-20 shrink-0">{timeRange(e.start, e.end)}</span>
                <span className="flex-1 truncate text-foreground/90">{e.title}</span>
                <Badge variant="outline" className={cn("text-[9px]", e.accountKind === "BUSINESS" ? "bg-amber-500/10 text-amber-300 border-amber-500/40" : "bg-blue-500/10 text-blue-300 border-blue-500/40")}>
                  {e.accountKind === "BUSINESS" ? "Biz" : "Priv"}
                </Badge>
              </div>
            ))
          )}
          {events.length > 8 && (
            <Link href="/calendar" className="text-xs text-primary hover:underline flex items-center gap-1 pt-1">
              +{events.length - 8} weitere · alle anzeigen <ChevronRight className="h-3 w-3" />
            </Link>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <ListTodo className="h-4 w-4 text-primary" /> Top-Aufgaben heute
            <Badge variant="outline" className="text-[10px] ml-auto">{topTodos.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {topTodos.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">Nichts dringendes. Sauberer Tag.</p>
          ) : (
            topTodos.map((t) => (
              <div key={t.id} className="flex items-center gap-2 text-xs py-1.5 border-t border-border/30 first:border-t-0">
                {t.priority && t.priority <= 2 && <span className="text-amber-300">●</span>}
                <span className="flex-1 truncate text-foreground/90">{t.title}</span>
                {t.due && t.due.startsWith(todayKey) && (
                  <Badge variant="outline" className="text-[9px] bg-red-500/10 text-red-300 border-red-500/40">Heute</Badge>
                )}
              </div>
            ))
          )}
          <Link href="/todos" className="text-xs text-primary hover:underline flex items-center gap-1 pt-1">
            Alle Todos <ChevronRight className="h-3 w-3" />
          </Link>
        </CardContent>
      </Card>

      {reco?.eveningPrep && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" /> Heute Abend
            </CardTitle>
          </CardHeader>
          <CardContent>
            <MarkdownMini text={reco.eveningPrep} />
          </CardContent>
        </Card>
      )}

      {reco?.tomorrowSetup && (
        <Card className="border-emerald-500/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Sunrise className="h-4 w-4 text-emerald-300" /> Setup Morgen
            </CardTitle>
          </CardHeader>
          <CardContent>
            <MarkdownMini text={reco.tomorrowSetup.slice(0, 1500)} />
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end pt-2">
        <Link href="/health">
          <Button size="sm" variant="ghost" className="text-xs">
            Voller Coach-Detail auf /health <ChevronRight className="h-3 w-3 ml-1" />
          </Button>
        </Link>
      </div>
    </div>
  );
}

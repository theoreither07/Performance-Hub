"use client";

/**
 * Wochenplaner Phase 2 — visuelle Wochenansicht mit existierenden Kalender-Events
 * UND vorgeschlagenen Trainings vom KI-Coach. Hover auf einem Trainings-Vorschlag
 * zeigt Uebungen / Distanz / Begruendung.
 *
 * Keine Kalender-Schreibung in dieser Phase — die kommt in Phase 4.
 */

import * as React from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { addDays, format, parseISO, startOfWeek, endOfWeek } from "date-fns";
import { de } from "@/lib/i18n/date-locale";
import {
  ArrowLeft, Calendar as CalendarIcon, CalendarCheck, ChevronDown, Dumbbell, Footprints,
  Loader2, Mountain, Sparkles, Wand2, MapPin, AlertTriangle, MessageSquare, Send,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { cn } from "@/lib/utils/cn";

interface CalendarEvent {
  id: string; title: string;
  start: string; end: string;
  allDay: boolean;
  accountKind: "PRIVATE" | "BUSINESS";
  location?: string;
}

interface ProposedSession {
  start: string; // HH:mm
  end: string;   // HH:mm
  type: "strength" | "cardio" | "long_cardio" | "mobility" | "rest";
  title: string;
  intensityStrength?: number;
  intensityCardio?: number;
  exercises?: Array<{ name: string; sets: number; reps: string; intensity?: string; notes?: string }>;
  cardio?: { subType: string; distanceKm?: number; durationMin?: number; zone?: string; hrTarget?: number };
  reasoning: string;
  conflicts: string[];
}

interface ProposedDay {
  date: string; dow: string;
  dayFocus: string;
  sessions: ProposedSession[];
}

interface DraftPlan {
  weekFocus: string;
  volumeAdjustPct: number;
  weekReasoning: string;
  openQuestions: string[];
  days: ProposedDay[];
}

interface DraftResponse {
  plan: {
    weekStart: string;
    generatedAt: string;
    provider: string;
    model: string;
    status: string;
    weekOverview: string | null;
    proposedSlots: DraftPlan | null;
    errorMessage: string | null;
    isForCurrentWeek?: boolean;
  } | null;
}

const DOW_DE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const HOUR_START = 6;
const HOUR_END = 22;
const ROW_HEIGHT_PX = 44; // pro Stunde
const TOTAL_HEIGHT = (HOUR_END - HOUR_START) * ROW_HEIGHT_PX;

function weekRange(offsetWeeks: number) {
  const now = new Date();
  const monday = startOfWeek(addDays(now, offsetWeeks * 7), { weekStartsOn: 1 });
  const sunday = endOfWeek(addDays(now, offsetWeeks * 7), { weekStartsOn: 1 });
  return { monday, sunday };
}

function hmToMinutes(hm: string): number {
  const [h, m] = hm.split(":").map((s) => parseInt(s, 10));
  return h * 60 + m;
}

function isoToHourFloat(iso: string): number {
  const d = parseISO(iso);
  return d.getHours() + d.getMinutes() / 60;
}

function durationHours(start: string, end: string): number {
  return (parseISO(end).getTime() - parseISO(start).getTime()) / 3600_000;
}

export default function WochenplanPage() {
  const qc = useQueryClient();
  // 0 = diese Woche, +1 = nächste Woche. Default: AKTUELLE Woche (User-Standard 2026-06-02).
  // User kann auf "Nächste Woche" wechseln um vorzuplanen.
  const [weekOffset, setWeekOffset] = React.useState<number>(0);
  const { monday, sunday } = React.useMemo(() => weekRange(weekOffset), [weekOffset]);
  const fromIso = monday.toISOString();
  const toIso = addDays(sunday, 1).toISOString();

  // Ansicht-Toggle: Woche (Mo-So) oder Tag (1 Tag mit detaillierter Stunden-Achse).
  // Default Mobile: TAG (man muss sonst horizontal scrollen). Desktop: WOCHE.
  const [viewMode, setViewMode] = React.useState<"week" | "day">("week");
  const todayKey = React.useMemo(() => format(new Date(), "yyyy-MM-dd"), []);
  const [activeDayKey, setActiveDayKey] = React.useState<string>(todayKey);
  const [userPickedView, setUserPickedView] = React.useState(false);

  // Beim ersten Mount: Mobile? → Tag-View. Spaeter respektieren wir User-Pick.
  React.useEffect(() => {
    if (userPickedView) return;
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 640px)");
    setViewMode(mq.matches ? "day" : "week");
  }, [userPickedView]);

  const pickView = React.useCallback((v: "week" | "day") => {
    setUserPickedView(true);
    setViewMode(v);
  }, []);

  // Wenn Wochen-Offset wechselt: aktiven Tag auf Montag dieser Woche resetten,
  // falls aktueller activeDayKey ausserhalb der Woche liegt.
  React.useEffect(() => {
    const mondayKey = format(monday, "yyyy-MM-dd");
    const sundayKey = format(sunday, "yyyy-MM-dd");
    if (activeDayKey < mondayKey || activeDayKey > sundayKey) {
      setActiveDayKey(mondayKey);
    }
  }, [monday, sunday, activeDayKey]);

  const weekStartKey = React.useMemo(() => format(monday, "yyyy-MM-dd"), [monday]);

  const draftQ = useQuery<DraftResponse>({
    queryKey: ["week-plan-draft", weekStartKey],
    queryFn: async () => {
      // Expliziter weekStart-Param: pro angezeigter Woche separater Plan.
      const res = await fetch(`/api/coach/week-plan/draft?weekStart=${weekStartKey}`);
      if (!res.ok) throw new Error("draft");
      return res.json();
    },
    staleTime: 60_000,
  });

  const eventsQ = useQuery<{ events: CalendarEvent[] }>({
    queryKey: ["calendar-range", fromIso, toIso],
    queryFn: async () => {
      const res = await fetch(`/api/calendar/range?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`);
      if (!res.ok) throw new Error("events");
      return res.json();
    },
    staleTime: 60_000,
  });

  const generate = useMutation({
    mutationFn: async () => {
      // Schick weekStart explizit mit, damit die richtige Woche geplant wird
      // (Default-Route plant sonst immer NAECHSTE Woche).
      const res = await fetch("/api/coach/week-plan/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ weekStart: weekStartKey }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        let data: unknown = null;
        try { data = JSON.parse(text); } catch { /* nicht-JSON */ }
        // ROBUST: data.error kann string, Object (Zod-Issues), oder undefined sein.
        const rec = (data && typeof data === "object") ? (data as Record<string, unknown>) : {};
        const errStr = typeof rec.error === "string" ? rec.error
          : rec.error ? JSON.stringify(rec.error)
          : rec.errors ? JSON.stringify(rec.errors)
          : text ? text.slice(0, 500)
          : `HTTP ${res.status} ${res.statusText}`;
        console.error("[wochenplan] generate failed:", { status: res.status, body: text, parsed: data });
        throw new Error(errStr);
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["week-plan-draft"] });
    },
  });

  // Chat-Diskussion mit Coach — eigener Thread topic=week-plan, getrennt vom Floating-Bubble-Chat
  const CHAT_TOPIC = "week-plan";
  const [draftMsg, setDraftMsg] = React.useState("");
  const chatQ = useQuery<{ messages: Array<{ id: string; role: "user" | "assistant" | "system"; content: string; createdAt: string }> }>({
    queryKey: ["coach-chat-history", CHAT_TOPIC],
    queryFn: async () => {
      const res = await fetch(`/api/coach/chat?topic=${CHAT_TOPIC}`);
      if (!res.ok) throw new Error("chat");
      return res.json();
    },
    staleTime: 30_000,
  });
  const sendMsg = useMutation({
    mutationFn: async (text: string) => {
      const res = await fetch("/api/coach/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, topic: CHAT_TOPIC }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(typeof data?.error === "string" ? data.error : data?.error ? JSON.stringify(data.error) : "Nachricht fehlgeschlagen");
      }
      return res.json();
    },
    onSuccess: () => {
      setDraftMsg("");
      qc.invalidateQueries({ queryKey: ["coach-chat-history", CHAT_TOPIC] });
      qc.invalidateQueries({ queryKey: ["week-plan-draft"] }); // falls Coach trotzdem refined hat
    },
  });

  const refine = useMutation({
    mutationFn: async (text: string) => {
      const res = await fetch("/api/coach/week-plan/refine", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ feedback: text, weekStart: weekStartKey }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(typeof data?.error === "string" ? data.error : data?.error ? JSON.stringify(data.error) : "Anpassen fehlgeschlagen");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["week-plan-draft"] });
    },
  });

  // Phase 4 — Apply to calendar
  const [confirmApplyOpen, setConfirmApplyOpen] = React.useState(false);
  const [applyResult, setApplyResult] = React.useState<{ created: number; deletedCoach: number; deletedUserTrainings: number; warnings: string[] } | null>(null);
  const apply = useMutation({
    mutationFn: async () => {
      // weekStart aus dem aktuell geladenen Plan mitschicken — sonst defaultet die Route auf NAECHSTE Woche
      // und findet den Plan fuer DIESE Woche nicht (TZ-Shift im weekStart-Lookup kommt dazu).
      const body: { weekStart?: string } = {};
      if (meta?.weekStart) body.weekStart = meta.weekStart;
      const res = await fetch("/api/coach/week-plan/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      if (!res.ok) throw new Error(typeof data?.error === "string" ? data.error : data?.error ? JSON.stringify(data.error) : "Uebertragen fehlgeschlagen");
      return data as { created: number; deletedCoach: number; deletedUserTrainings: number; warnings: string[] };
    },
    onSuccess: (r) => {
      setApplyResult(r);
      setConfirmApplyOpen(false);
      qc.invalidateQueries({ queryKey: ["week-plan-draft"] });
      qc.invalidateQueries({ queryKey: ["calendar-range"] });
    },
  });

  // Letzte 8 Nachrichten anzeigen, chronologisch
  const recentMsgs = (chatQ.data?.messages ?? []).slice(-8);
  // Letzte User-Nachrichten als Konsens-Text (fuer expliziten Refine)
  const lastUserMsgs = recentMsgs.filter((m) => m.role === "user").slice(-3).map((m) => m.content);
  const consensusText = lastUserMsgs.length > 0
    ? `Aus unserer Diskussion: ${lastUserMsgs.join(" | ")}`
    : "";

  const chatScrollRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [recentMsgs.length, sendMsg.isPending]);

  const plan = draftQ.data?.plan?.proposedSlots ?? null;
  const meta = draftQ.data?.plan ?? null;
  const events = eventsQ.data?.events ?? [];
  const isNextWeekPlan = meta && meta.isForCurrentWeek === false;
  const planSessionCount = React.useMemo(() => {
    if (!plan) return 0;
    return plan.days.reduce((sum, d) => sum + (d.sessions?.length ?? 0), 0);
  }, [plan]);
  const isApplied = meta?.status === "applied";

  // Events nach Datum gruppieren — Coach-managed Events filtern wir RAUS wenn das
  // korrespondierende Plan-Session bereits gerendert wird (sonst Duplikat im Grid).
  // Coach-managed Events erkennen wir am [Coach] Titel-Praefix.
  const eventsByDate = React.useMemo(() => {
    const out: Record<string, CalendarEvent[]> = {};
    for (const e of events) {
      const isCoachEvent = e.title.startsWith("[Coach]");
      if (isCoachEvent) continue; // Plan-Sessions zeigen die schon
      const key = e.start.slice(0, 10);
      (out[key] ??= []).push(e);
    }
    return out;
  }, [events]);

  // Vorgeschlagene Sessions nach Datum
  const sessionsByDate = React.useMemo(() => {
    const out: Record<string, ProposedDay> = {};
    if (plan) for (const d of plan.days) out[d.date] = d;
    return out;
  }, [plan]);

  // Spalten der Wochenansicht (Mo-So)
  const weekDays = React.useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = addDays(monday, i);
      const key = format(d, "yyyy-MM-dd");
      return { date: d, key, dow: DOW_DE[i] };
    });
  }, [monday]);

  // Anzeige-Tage je nach viewMode: ganze Woche oder nur 1 Tag (Tagesansicht)
  const days = React.useMemo(() => {
    if (viewMode === "week") return weekDays;
    return weekDays.filter((d) => d.key === activeDayKey).length > 0
      ? weekDays.filter((d) => d.key === activeDayKey)
      : weekDays.slice(0, 1);
  }, [viewMode, weekDays, activeDayKey]);

  // Grid-Spalten: Wochenansicht hat 7 schmale, Tagesansicht 1 breite Spalte.
  const gridCols = viewMode === "week"
    ? "64px repeat(7, minmax(0, 1fr))"
    : "64px minmax(0, 1fr)";
  const gridMinWidth = viewMode === "week" ? "920px" : "100%";

  return (
    <div className="flex flex-col gap-4 sm:gap-6 pb-24 sm:pb-0">
      <div className="order-1 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 sm:gap-3">
            <Link href="/health" className="text-muted-foreground hover:text-foreground shrink-0">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <h1 className="text-xl sm:text-2xl font-bold truncate">Trainings-Wochenplaner</h1>
          </div>
          <p className="text-muted-foreground text-xs sm:text-sm mt-1">
            {weekOffset === 0 ? "Aktuelle Woche" : weekOffset === 1 ? "Naechste Woche" : "Woche"}: <span className="font-medium text-foreground">{format(monday, "d. MMM", { locale: de })} – {format(sunday, "d. MMM yyyy", { locale: de })}</span>
            {meta && (
              <span className="block sm:inline"> · Letzter Vorschlag {format(parseISO(meta.generatedAt), "d. MMM HH:mm", { locale: de })} ({meta.provider})</span>
            )}
            {isApplied && (
              <span className="ml-1 inline-flex items-center gap-1 text-emerald-300 text-[10px] uppercase tracking-wider font-medium">
                <CalendarCheck className="h-3 w-3" /> In Kalender
              </span>
            )}
          </p>
        </div>
        {/* Desktop-Buttons rechts oben — Mobile verwendet Sticky-Bottom-Bar unten */}
        <div className="hidden sm:flex sm:flex-row sm:items-center gap-2 sm:shrink-0">
          <Button
            onClick={() => generate.mutate()}
            disabled={generate.isPending || apply.isPending}
            size="sm"
            variant="outline"
          >
            {generate.isPending ? (
              <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Plane (1-2 min)...</>
            ) : (
              <><Wand2 className="h-4 w-4 mr-1.5" /> {plan ? "Neu planen" : "Trainings-Woche planen"}</>
            )}
          </Button>
          {plan && (
            <Button
              onClick={() => { setApplyResult(null); setConfirmApplyOpen(true); }}
              disabled={apply.isPending || generate.isPending}
              size="sm"
            >
              {apply.isPending ? (
                <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Uebertrage...</>
              ) : (
                <><CalendarCheck className="h-4 w-4 mr-1.5" /> {isApplied ? "Erneut uebertragen" : "In Kalender uebertragen"}</>
              )}
            </Button>
          )}
        </div>
      </div>

      {/* 7-Tage-Snapshot — order-2: direkt unter Header. Eine-Zeile-Übersicht der Woche.
          Mobile-friendly Pills mit Icon pro Tag, "heute" highlighted. Klick navigiert in Tag-View. */}
      {plan && (
        <div className="order-2 -mx-1 px-1 overflow-x-auto" style={{ WebkitOverflowScrolling: "touch" }}>
          <div className="flex gap-1.5 min-w-max">
            {weekDays.map((d) => {
              const session = sessionsByDate[d.key];
              const firstType = session?.sessions?.[0]?.type;
              const isToday = d.key === todayKey;
              const isActive = viewMode === "day" && d.key === activeDayKey;
              const TypeIcon = firstType === "strength" ? Dumbbell
                : firstType === "long_cardio" ? Mountain
                : firstType === "cardio" ? Footprints
                : firstType === "mobility" ? Sparkles
                : null;
              const typeColor = firstType === "strength" ? "text-amber-300"
                : firstType === "cardio" ? "text-sky-300"
                : firstType === "long_cardio" ? "text-violet-300"
                : firstType === "mobility" ? "text-emerald-300"
                : "text-muted-foreground/60";
              return (
                <button
                  key={d.key}
                  type="button"
                  onClick={() => { setActiveDayKey(d.key); pickView("day"); }}
                  className={cn(
                    "shrink-0 flex flex-col items-center gap-1 px-3 py-2 rounded-lg border transition-all",
                    isActive
                      ? "border-primary bg-primary/15"
                      : isToday
                      ? "border-primary/40 bg-primary/5"
                      : "border-border/40 bg-card hover:bg-muted/20",
                  )}
                >
                  <span className={cn("text-[10px] uppercase tracking-wider", isToday ? "text-primary font-bold" : "text-muted-foreground")}>
                    {isToday ? "Heute" : d.dow}
                  </span>
                  <span className="text-xs font-semibold tabular-nums">{format(d.date, "d.M.")}</span>
                  <div className="h-4 w-4 flex items-center justify-center">
                    {TypeIcon ? <TypeIcon className={cn("h-3.5 w-3.5", typeColor)} /> : <span className="h-1 w-1 rounded-full bg-muted-foreground/30" />}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {generate.isError && (
        <Card className="order-2 border-destructive/40">
          <CardContent className="py-3 text-sm flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
            <span className="break-words">{(() => {
              const e = generate.error as unknown;
              if (e instanceof Error) return e.message || "Unbekannter Fehler";
              if (typeof e === "string") return e;
              if (e && typeof e === "object") {
                try { return JSON.stringify(e, null, 2); } catch { return String(e); }
              }
              return String(e);
            })()}</span>
          </CardContent>
        </Card>
      )}

      {/* Coach-Begruendung der Woche — order-4: NACH dem Plan, weil Plan das Wichtigere ist.
          Default eingeklappt auf Mobile damit das Layout nicht erschlagen wird. */}
      {plan && (
        <Card className="order-4 overflow-hidden">
          <details className="group" open>
            <summary className="cursor-pointer list-none select-none px-6 py-4 flex items-center justify-between gap-2 hover:bg-muted/10 transition-colors">
              <span className="flex items-center gap-2 flex-wrap text-base font-semibold">
                <Sparkles className="h-4 w-4 text-primary" /> Coach-Story
                {plan.volumeAdjustPct !== 0 && (
                  <Badge variant={plan.volumeAdjustPct > 0 ? "biz" : "outline"} className="text-[10px]">
                    Volumen {plan.volumeAdjustPct > 0 ? "+" : ""}{plan.volumeAdjustPct}%
                  </Badge>
                )}
                {isNextWeekPlan === false && (
                  <Badge variant="outline" className="text-[10px]">laufende Woche</Badge>
                )}
              </span>
              <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <CardContent className="space-y-4 text-sm pt-2">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5 font-semibold">Wochen-Fokus</p>
              <p className="text-base font-semibold leading-snug text-foreground">{plan.weekFocus}</p>
            </div>
            <div className="relative border-l-2 border-primary/60 pl-4 py-2 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent rounded-r-lg">
              <p className="text-[10px] uppercase tracking-wider text-primary mb-2 font-bold">Daten-Begründung</p>
              <p className="text-foreground/90 leading-relaxed whitespace-pre-wrap">{plan.weekReasoning}</p>
            </div>
            {plan.openQuestions.length > 0 && (
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Rueckfragen vom Coach</p>
                <ul className="space-y-1.5">
                  {plan.openQuestions.map((q, i) => (
                    <li key={i} className="text-amber-300 text-sm flex items-start gap-2">
                      <span className="text-amber-400/60 mt-0.5">›</span>
                      <span>{q}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Diskussion mit dem Coach — klappbar, default zu */}
            <details className="group border-t border-border/40 pt-3 -mx-6 px-6 [&[open]]:pb-2">
              <summary className="cursor-pointer list-none select-none flex items-center justify-between gap-2 py-1 hover:bg-muted/10 -mx-2 px-2 rounded">
                <span className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <MessageSquare className="h-3 w-3" /> Diskussion mit dem Coach
                  {recentMsgs.length > 0 && (
                    <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-primary/20 text-primary text-[10px] font-semibold px-1.5">
                      {recentMsgs.length}
                    </span>
                  )}
                </span>
                <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <div className="space-y-2 pt-2">
              <p className="text-[10px] text-muted-foreground">
                Frag nach, schlag Anpassungen vor. Der Coach diskutiert mit dir und passt den Plan
                erst an, wenn du <strong>„Plan jetzt anpassen"</strong> klickst (oder ihm explizit
                ok gibst).
              </p>

              {/* Thread */}
              <div
                ref={chatScrollRef}
                className="max-h-72 overflow-y-auto rounded-md border border-border/40 bg-muted/10 p-2 space-y-2 scrollbar-thin"
              >
                {recentMsgs.length === 0 && (
                  <p className="text-xs text-muted-foreground italic py-4 text-center">
                    Noch keine Nachrichten. Stell eine Frage oder bring eine Idee ein.
                  </p>
                )}
                {recentMsgs.map((msg) => (
                  <div
                    key={msg.id}
                    className={cn(
                      "rounded px-3 py-2 text-sm max-w-[88%] whitespace-pre-wrap",
                      msg.role === "user"
                        ? "ml-auto bg-primary/20 border border-primary/30 text-foreground"
                        : "mr-auto bg-card border border-border text-foreground/90"
                    )}
                  >
                    {msg.content}
                  </div>
                ))}
                {sendMsg.isPending && (
                  <div className="mr-auto bg-card border border-border rounded px-3 py-2 text-xs text-muted-foreground italic">
                    Coach denkt...
                  </div>
                )}
              </div>

              {/* Input */}
              <div className="flex gap-2">
                <Textarea
                  value={draftMsg}
                  onChange={(e) => setDraftMsg(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      if (draftMsg.trim() && !sendMsg.isPending) sendMsg.mutate(draftMsg);
                    }
                  }}
                  placeholder={
                    "Frag den Coach: 'Warum hast du Mo Push gemacht?' / 'Knie zwickt — schwerer Do ok?' / " +
                    "'Sommernachtsfest Sa abends, eher 2 Glas Wein.' (Cmd/Ctrl+Enter = Senden)"
                  }
                  rows={2}
                  className="text-sm flex-1"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => sendMsg.mutate(draftMsg)}
                  disabled={!draftMsg.trim() || sendMsg.isPending}
                  className="self-end"
                >
                  {sendMsg.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                </Button>
              </div>

              {(sendMsg.isError || refine.isError) && (
                <p className="text-xs text-red-400">
                  {((sendMsg.error ?? refine.error) as Error)?.message}
                </p>
              )}

              {/* Manueller Refine-Trigger */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 border-t border-border/30">
                <p className="text-[10px] text-muted-foreground flex-1">
                  Wenn ihr euch einig seid: hier den Plan anpassen lassen (nimmt deine letzten
                  Nachrichten als Konsens-Anweisung).
                </p>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => refine.mutate(consensusText || "Plan an die juengste Diskussion anpassen.")}
                  disabled={refine.isPending || sendMsg.isPending || generate.isPending}
                  className="self-end sm:self-auto"
                >
                  {refine.isPending ? (
                    <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Coach passt an (~1 min)...</>
                  ) : (
                    <><Wand2 className="h-3.5 w-3.5 mr-1.5" /> Plan jetzt anpassen</>
                  )}
                </Button>
              </div>
              </div>
            </details>
          </CardContent>
          </details>
        </Card>
      )}

      {/* Wochengrid — order-3: direkt nach Header das Wichtigste */}
      <Card className="order-3">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between gap-2 flex-wrap">
            <span className="flex items-center gap-2">
              <CalendarIcon className="h-4 w-4 text-primary" />
              {viewMode === "week" ? "Wochenansicht" : "Tagesansicht"}
              <span className="text-xs font-normal text-muted-foreground tabular-nums">
                {viewMode === "week"
                  ? `(${format(monday, "d.M.")}–${format(sunday, "d.M.")})`
                  : `(${format(parseISO(activeDayKey), "EEEE d.M.", { locale: de })})`}
              </span>
            </span>
            <div className="flex flex-wrap items-center gap-1">
              <div className="flex items-center gap-1 mr-2">
                <Button
                  size="sm"
                  variant={viewMode === "week" ? "default" : "outline"}
                  className="h-7 text-xs"
                  onClick={() => pickView("week")}
                >
                  Woche
                </Button>
                <Button
                  size="sm"
                  variant={viewMode === "day" ? "default" : "outline"}
                  className="h-7 text-xs"
                  onClick={() => pickView("day")}
                >
                  Tag
                </Button>
              </div>
              <Button
                size="sm"
                variant={weekOffset === 0 ? "default" : "outline"}
                className="h-7 text-xs"
                onClick={() => { setWeekOffset(0); generate.reset(); refine.reset(); }}
              >
                Diese Woche
              </Button>
              <Button
                size="sm"
                variant={weekOffset === 1 ? "default" : "outline"}
                className="h-7 text-xs"
                onClick={() => { setWeekOffset(1); generate.reset(); refine.reset(); }}
              >
                Nächste Woche
              </Button>
            </div>
          </CardTitle>
          {viewMode === "day" && (
            <div className="flex items-center gap-1 mt-2 overflow-x-auto pb-1">
              {weekDays.map((d) => {
                const isActive = d.key === activeDayKey;
                const isToday = d.key === todayKey;
                return (
                  <Button
                    key={d.key}
                    size="sm"
                    variant={isActive ? "default" : "outline"}
                    className={cn(
                      "h-7 text-xs px-2 shrink-0 tabular-nums",
                      isToday && !isActive && "border-primary/60"
                    )}
                    onClick={() => setActiveDayKey(d.key)}
                  >
                    {d.dow} {format(d.date, "d.M.")}
                  </Button>
                );
              })}
            </div>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: "touch" }}>
            <div className="px-3 pb-4" style={{ minWidth: gridMinWidth }}>
              {/* Tages-Header */}
              <div className="grid" style={{ gridTemplateColumns: gridCols }}>
                <div />
                {days.map((d) => {
                  const sessions = sessionsByDate[d.key];
                  return (
                    <div key={d.key} className="text-center py-2 border-l border-border/40 min-w-0 overflow-hidden">
                      <p className="text-xs font-semibold">{d.dow}</p>
                      <p className="text-[10px] text-muted-foreground">{format(d.date, "d.M.", { locale: de })}</p>
                      {sessions?.dayFocus && (
                        <p className="text-[10px] text-primary/80 mt-0.5 truncate px-1" title={sessions.dayFocus}>
                          {sessions.dayFocus}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* All-Day-Banner */}
              {days.some((d) => (eventsByDate[d.key] ?? []).some((e) => e.allDay)) && (
                <div className="grid" style={{ gridTemplateColumns: gridCols }}>
                  <div className="text-[9px] uppercase tracking-wider text-muted-foreground py-1 pr-1 text-right">Ganzt.</div>
                  {days.map((d) => {
                    const all = (eventsByDate[d.key] ?? []).filter((e) => e.allDay);
                    return (
                      <div key={d.key} className="border-l border-border/40 px-1 py-1 space-y-0.5 min-h-[24px] min-w-0">
                        {all.map((e) => (
                          <div
                            key={e.id}
                            className={cn(
                              "rounded px-1.5 py-0.5 text-[10px] truncate",
                              e.accountKind === "BUSINESS"
                                ? "bg-blue-500/15 text-blue-200 border border-blue-500/30"
                                : "bg-violet-500/15 text-violet-200 border border-violet-500/30"
                            )}
                            title={e.title}
                          >
                            {e.title}
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Time-Grid */}
              <div className="grid relative" style={{ gridTemplateColumns: gridCols, height: `${TOTAL_HEIGHT}px` }}>
                {/* Stundenleiste */}
                <div className="relative">
                  {Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i).map((h) => (
                    <div
                      key={h}
                      className="absolute right-1 text-[10px] text-muted-foreground tabular-nums"
                      style={{ top: `${(h - HOUR_START) * ROW_HEIGHT_PX - 6}px` }}
                    >
                      {h.toString().padStart(2, "0")}:00
                    </div>
                  ))}
                </div>

                {/* Tages-Spalten */}
                {days.map((d) => (
                  <DayColumn
                    key={d.key}
                    dateKey={d.key}
                    events={(eventsByDate[d.key] ?? []).filter((e) => !e.allDay)}
                    sessions={sessionsByDate[d.key]?.sessions ?? []}
                  />
                ))}
              </div>
            </div>
          </div>
          {!plan && !generate.isPending && (
            <div className="px-6 pb-6 text-sm text-muted-foreground">
              Noch kein Plan fuer {weekOffset === 0 ? "DIESE" : "die NAECHSTE"} Woche. Klick oben auf
              <strong> „Trainings-Woche planen"</strong> — der Coach analysiert deine letzten 14 Tage,
              deine Slots, dein Setup und die Termine der gewaehlten Woche, und schlaegt dir konkrete
              Trainings vor.
              {weekOffset === 1 && (
                <span className="block mt-2 text-xs italic">
                  Tipp: Du kannst die naechste Woche schon im Voraus planen — am Sonntag kannst du jederzeit
                  neu planen, der aktuelle Wochenplan bleibt davon unangetastet.
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Apply-Result Banner */}
      {applyResult && (
        <Card className="order-5 border-emerald-500/40 bg-emerald-500/5">
          <CardContent className="py-3 text-sm space-y-1">
            <p className="font-medium flex items-center gap-2 text-emerald-300">
              <CalendarCheck className="h-4 w-4" />
              In Kalender uebertragen: {applyResult.created} neue Trainings angelegt
              {applyResult.deletedCoach > 0 && `, ${applyResult.deletedCoach} alte Coach-Events ersetzt`}
              {applyResult.deletedUserTrainings > 0 && `, ${applyResult.deletedUserTrainings} eigene Trainings-Termine entfernt`}.
            </p>
            {applyResult.warnings.length > 0 && (
              <ul className="text-xs text-amber-300 list-disc list-inside">
                {applyResult.warnings.slice(0, 5).map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
      {apply.isError && (
        <Card className="border-destructive/40">
          <CardContent className="py-3 text-sm flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
            <span>{(apply.error as Error).message}</span>
          </CardContent>
        </Card>
      )}

      {/* Apply-Confirmation-Dialog */}
      <Dialog open={confirmApplyOpen} onOpenChange={(o) => !o && setConfirmApplyOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Plan in Kalender uebertragen?</DialogTitle>
            <DialogDescription className="text-xs">
              Schreibt {planSessionCount} Trainings in deinen <strong>privaten</strong> Kalender.
              Ersetzt werden: alle vorhandenen Coach-Events der Woche UND alle eigenen Trainings-Termine
              (Titel mit <code className="bg-muted px-1 rounded">Krafttraining:</code>,{" "}
              <code className="bg-muted px-1 rounded">Cardio:</code>,{" "}
              <code className="bg-muted px-1 rounded">Lauf:</code>,{" "}
              <code className="bg-muted px-1 rounded">Yoga:</code> etc.).{" "}
              <strong>Business-Termine, private Termine (Arzt etc.) und sonstige Events bleiben unangetastet.</strong>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-xs text-muted-foreground">
            <p>Marker auf Coach-Events: Titel-Praefix <code className="bg-muted px-1 rounded">[Coach]</code> + Tag <code className="bg-muted px-1 rounded">coach_managed=true</code>.</p>
            <p>Falls die Uebertragung fehlschlaegt mit „Schreibrecht fehlt": privaten Account in <a href="/settings" className="text-primary underline">/settings</a> neu verbinden.</p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setConfirmApplyOpen(false)} disabled={apply.isPending}>
              Abbrechen
            </Button>
            <Button type="button" onClick={() => apply.mutate()} disabled={apply.isPending}>
              {apply.isPending ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Uebertrage...</> : <><CalendarCheck className="h-3.5 w-3.5 mr-1.5" /> Jetzt uebertragen</>}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Tages-Detailansicht — im Tag-Modus nur aktiven Tag, sonst alle. order-6 ganz unten. */}
      {plan && viewMode === "day" && (
        <Card className="order-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Tages-Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {(viewMode === "day"
              ? plan.days.filter((d) => d.date === activeDayKey)
              : plan.days
            ).map((d) => (
              <DaySummary key={d.date} day={d} />
            ))}
            {viewMode === "day" && plan.days.filter((d) => d.date === activeDayKey).length === 0 && (
              <p className="text-sm text-muted-foreground italic">
                Kein Plan-Detail fuer diesen Tag.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Sticky Bottom Action-Bar — nur Mobile, gibt CTAs immer in Reichweite ohne zu scrollen.
          Padding-bottom auf Page selbst (pb-24) verhindert dass die Bar Content verdeckt. */}
      <div
        className={cn(
          "sm:hidden fixed bottom-0 left-0 right-0 z-30",
          "border-t border-border/40 bg-card/95 backdrop-blur-md",
          "pb-[max(env(safe-area-inset-bottom),0px)]",
          "px-3 py-2 flex gap-2",
        )}
      >
        <Button
          onClick={() => generate.mutate()}
          disabled={generate.isPending || apply.isPending}
          size="sm"
          variant="outline"
          className="flex-1"
        >
          {generate.isPending ? (
            <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Plane...</>
          ) : (
            <><Wand2 className="h-4 w-4 mr-1.5" /> {plan ? "Neu planen" : "Planen"}</>
          )}
        </Button>
        {plan && (
          <Button
            onClick={() => { setApplyResult(null); setConfirmApplyOpen(true); }}
            disabled={apply.isPending || generate.isPending}
            size="sm"
            className="flex-1"
          >
            {apply.isPending ? (
              <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Übertrage...</>
            ) : (
              <><CalendarCheck className="h-4 w-4 mr-1.5" /> {isApplied ? "Neu übertragen" : "In Kalender"}</>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

function DayColumn({
  dateKey,
  events,
  sessions,
}: {
  dateKey: string;
  events: CalendarEvent[];
  sessions: ProposedSession[];
}) {
  // Helper: Zeitfenster in Minuten
  const eventRange = (e: CalendarEvent) => ({
    start: isoToHourFloat(e.start) * 60,
    end: isoToHourFloat(e.end) * 60,
  });
  const sessionRange = (s: ProposedSession) => ({
    start: hmToMinutes(s.start),
    end: hmToMinutes(s.end),
  });
  const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) =>
    aStart < bEnd && bStart < aEnd;

  // Pro Event: gibt es ueberlappenden Vorschlag? → Event nach links halbieren.
  const sessionTimes = sessions.map(sessionRange);
  // Pro Session: gibt es ueberlappendes Event? → Session nach rechts halbieren.
  const eventTimes = events.map(eventRange);

  return (
    <div className="relative border-l border-border/40">
      {/* Stunden-Trenner */}
      {Array.from({ length: HOUR_END - HOUR_START }, (_, i) => i).map((i) => (
        <div
          key={i}
          className="absolute left-0 right-0 border-b border-border/15"
          style={{ top: `${i * ROW_HEIGHT_PX}px`, height: `${ROW_HEIGHT_PX}px` }}
        />
      ))}
      {/* Events */}
      {events.map((e) => {
        const top = Math.max(0, (isoToHourFloat(e.start) - HOUR_START) * ROW_HEIGHT_PX);
        const h = Math.max(0.5, durationHours(e.start, e.end));
        const height = h * ROW_HEIGHT_PX;
        if (top >= TOTAL_HEIGHT || top + height <= 0) return null;
        const er = eventRange(e);
        const hasOverlap = sessionTimes.some((s) => overlaps(er.start, er.end, s.start, s.end));
        const pos = hasOverlap
          ? { left: "2px", width: "calc(50% - 4px)" }
          : { left: "2px", right: "2px" };
        return (
          <div
            key={e.id}
            className={cn(
              "absolute rounded px-1.5 py-1 text-[10px] overflow-hidden",
              e.accountKind === "BUSINESS"
                ? "bg-blue-500/20 border border-blue-500/40 text-blue-100"
                : "bg-violet-500/20 border border-violet-500/40 text-violet-100"
            )}
            style={{ top: `${top}px`, height: `${Math.max(20, height)}px`, ...pos }}
            title={`${e.title}${e.location ? ` @ ${e.location}` : ""}`}
          >
            <p className="font-medium truncate leading-tight">{e.title}</p>
            <p className="text-[9px] opacity-80 truncate">
              {e.start.slice(11, 16)}–{e.end.slice(11, 16)}
              {e.location ? ` · ${e.location}` : ""}
            </p>
          </div>
        );
      })}
      {/* Vorgeschlagene Sessions */}
      {sessions.map((s, i) => {
        const sr = sessionRange(s);
        const top = Math.max(0, (sr.start / 60 - HOUR_START) * ROW_HEIGHT_PX);
        const height = Math.max(28, ((sr.end - sr.start) / 60) * ROW_HEIGHT_PX);
        if (top >= TOTAL_HEIGHT) return null;
        const hasOverlap = eventTimes.some((e) => overlaps(sr.start, sr.end, e.start, e.end));
        const pos = hasOverlap
          ? { left: "50%", right: "2px" }
          : { left: "2px", right: "2px" };
        return (
          <ProposedSlot
            key={`${dateKey}-${i}`}
            session={s}
            style={{ top: `${top}px`, height: `${height}px`, ...pos }}
          />
        );
      })}
    </div>
  );
}

// Session-Type-Identity: jede Sport-Art bekommt eine eigene Farb-Identitaet.
// Strength = warm amber, Cardio = sky, Long-Cardio = violet, Mobility = emerald.
// Dadurch erkennt man auf einen Blick was geplant ist, ohne Icon lesen zu muessen.
const SESSION_TYPE_STYLES: Record<string, { bg: string; border: string; icon: React.ComponentType<{ className?: string }> }> = {
  strength: {
    bg: "bg-amber-500/25 hover:bg-amber-500/35",
    border: "border-2 border-amber-400/70 shadow-sm shadow-amber-500/20",
    icon: Dumbbell,
  },
  cardio: {
    bg: "bg-sky-500/25 hover:bg-sky-500/35",
    border: "border-2 border-sky-400/70 shadow-sm shadow-sky-500/20",
    icon: Footprints,
  },
  long_cardio: {
    bg: "bg-violet-500/25 hover:bg-violet-500/35",
    border: "border-2 border-violet-400/70 shadow-sm shadow-violet-500/20",
    icon: Mountain,
  },
  mobility: {
    bg: "bg-emerald-500/20 hover:bg-emerald-500/30",
    border: "border border-emerald-400/60",
    icon: Footprints,
  },
};

function ProposedSlot({ session, style }: { session: ProposedSession; style: React.CSSProperties }) {
  const typeStyle = SESSION_TYPE_STYLES[session.type] ?? {
    bg: "bg-primary/25 hover:bg-primary/35",
    border: "border-2 border-primary/70 shadow-sm shadow-primary/20",
    icon: Footprints,
  };
  const Icon = typeStyle.icon;
  const ref = React.useRef<HTMLDivElement>(null);
  const [tipPos, setTipPos] = React.useState<{ left: number; top: number; width: number } | null>(null);

  const showTip = React.useCallback(() => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const tipW = Math.min(320, window.innerWidth - 16); // mobile: max viewport breite
    const margin = 8;
    let left = r.right + margin;
    if (left + tipW > window.innerWidth - 8) {
      left = r.left - tipW - margin;
      if (left < 8) {
        left = Math.max(8, Math.min(window.innerWidth - tipW - 8, r.left));
      }
    }
    const top = Math.max(8, Math.min(window.innerHeight - 200, r.top));
    setTipPos({ left, top, width: tipW });
  }, []);
  const hideTip = React.useCallback(() => setTipPos(null), []);
  const toggleTip = React.useCallback(() => {
    if (tipPos) hideTip();
    else showTip();
  }, [tipPos, hideTip, showTip]);

  return (
    <>
      <div
        ref={ref}
        onMouseEnter={showTip}
        onMouseLeave={hideTip}
        onFocus={showTip}
        onBlur={hideTip}
        onClick={(e) => { e.stopPropagation(); toggleTip(); }}
        tabIndex={0}
        className={cn(
          "absolute rounded-md px-1.5 py-1 text-[10px] cursor-pointer transition-all z-10 text-foreground",
          typeStyle.bg,
          typeStyle.border,
        )}
        style={style}
      >
        <div className="flex items-center gap-1">
          <Icon className="h-3 w-3 shrink-0" />
          <p className="font-semibold truncate">{session.title}</p>
        </div>
        <p className="text-[9px] opacity-80 truncate">
          {session.start}–{session.end}
          {session.cardio?.distanceKm ? ` · ${session.cardio.distanceKm}km` : ""}
          {session.cardio?.zone ? ` · ${session.cardio.zone}` : ""}
        </p>
      </div>
      {tipPos && typeof document !== "undefined" && createPortal(
        <div
          style={{
            position: "fixed",
            left: tipPos.left,
            top: tipPos.top,
            width: tipPos.width,
            zIndex: 2147483000, // praktisch hoechstmoeglich
            isolation: "isolate",
            pointerEvents: "none",
          }}
        >
          <div
            className="rounded-lg border border-border shadow-2xl p-3 text-foreground text-xs space-y-2"
            style={{ backgroundColor: "rgb(15, 15, 17)" }}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold text-sm">{session.title}</p>
              <span className="text-[10px] text-muted-foreground tabular-nums">{session.start}–{session.end}</span>
            </div>
            {(session.intensityStrength != null || session.intensityCardio != null) && (
              <div className="flex gap-2">
                {(session.intensityStrength ?? 0) > 0 && (
                  <Badge variant="outline" className="text-[10px]">Kraft {session.intensityStrength}/10</Badge>
                )}
                {(session.intensityCardio ?? 0) > 0 && (
                  <Badge variant="outline" className="text-[10px]">Cardio {session.intensityCardio}/10</Badge>
                )}
              </div>
            )}
            {session.exercises && session.exercises.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Uebungen</p>
                <ul className="space-y-0.5">
                  {session.exercises.map((ex, i) => (
                    <li key={i} className="text-xs leading-tight">
                      <span className="font-medium">{ex.name}</span>{" "}
                      <span className="text-muted-foreground">
                        {ex.sets}×{ex.reps}{ex.intensity ? ` · ${ex.intensity}` : ""}
                      </span>
                      {ex.notes && <span className="block text-[10px] text-muted-foreground/80 pl-2">{ex.notes}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {session.cardio && (
              <div className="space-y-0.5 text-xs">
                {session.cardio.distanceKm && <p>Distanz: <span className="tabular-nums">{session.cardio.distanceKm} km</span></p>}
                {session.cardio.durationMin && <p>Dauer: <span className="tabular-nums">{session.cardio.durationMin} min</span></p>}
                {session.cardio.zone && <p>Zone: {session.cardio.zone}</p>}
                {session.cardio.hrTarget && <p>HR-Ziel: <span className="tabular-nums">{session.cardio.hrTarget} bpm</span></p>}
              </div>
            )}
            {session.reasoning && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Warum genau das</p>
                <p className="text-xs text-muted-foreground italic leading-relaxed">{session.reasoning}</p>
              </div>
            )}
            {session.conflicts.length > 0 && (
              <div className="flex items-start gap-1.5 text-amber-300">
                <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                <span className="text-xs">Knapp mit: {session.conflicts.join(", ")}</span>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

function DaySummary({ day }: { day: ProposedDay }) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-2">
        <p className="text-sm font-semibold">{day.dow} {format(parseISO(day.date), "d. MMM", { locale: de })}</p>
        <p className="text-xs text-muted-foreground">{day.dayFocus}</p>
      </div>
      {day.sessions.length === 0 && (
        <p className="text-xs text-muted-foreground pl-3 border-l-2 border-border/40">Restday</p>
      )}
      {day.sessions.map((s, i) => {
        const Icon = s.type === "strength" ? Dumbbell : s.type === "long_cardio" ? Mountain : Footprints;
        return (
          <div key={i} className="pl-3 border-l-2 border-primary/40 space-y-1">
            <div className="flex items-center gap-2">
              <Icon className="h-3.5 w-3.5 text-primary" />
              <p className="text-sm font-medium">{s.title}</p>
              <span className="text-xs text-muted-foreground tabular-nums">{s.start}–{s.end}</span>
            </div>
            {s.exercises && s.exercises.length > 0 && (
              <ul className="text-xs text-muted-foreground space-y-0.5 ml-5">
                {s.exercises.map((ex, j) => (
                  <li key={j}>
                    {ex.name} <span className="tabular-nums">{ex.sets}×{ex.reps}</span>
                    {ex.intensity && <span className="ml-1">· {ex.intensity}</span>}
                  </li>
                ))}
              </ul>
            )}
            {s.cardio && (
              <p className="text-xs text-muted-foreground ml-5 tabular-nums">
                {s.cardio.distanceKm ? `${s.cardio.distanceKm} km` : ""}
                {s.cardio.durationMin ? ` · ${s.cardio.durationMin} min` : ""}
                {s.cardio.zone ? ` · ${s.cardio.zone}` : ""}
                {s.cardio.hrTarget ? ` · HR ${s.cardio.hrTarget}` : ""}
              </p>
            )}
            <p className="text-xs text-muted-foreground italic ml-5 leading-relaxed">{s.reasoning}</p>
            {s.conflicts.length > 0 && (
              <p className="text-xs text-amber-300 ml-5 flex items-center gap-1">
                <MapPin className="h-3 w-3" /> Knapp mit: {s.conflicts.join(", ")}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

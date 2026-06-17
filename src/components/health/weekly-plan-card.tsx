"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { CollapsibleCard } from "@/components/ui/collapsible-card";
import { CalendarRange, RefreshCw, AlertTriangle, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { format, parseISO } from "date-fns";
import { de } from "@/lib/i18n/date-locale";

interface WeeklyPlan {
  id: string;
  weekStart: string;
  generatedAt: string;
  provider: string;
  model: string;
  weekOverview: string | null;
  schedule: string | null;
  watchouts: string | null;
  errorMessage: string | null;
  isForCurrentWeek?: boolean;
}

function Markdown({ text }: { text: string }) {
  // Identisch zum AiCoachCard-Renderer — mit ### Sub-Headlines, Bullets, fett.
  const lines = text.split("\n");
  const blocks: React.ReactNode[] = [];
  let listBuf: string[] = [];
  let pBuf: string[] = [];
  const flushList = () => {
    if (listBuf.length > 0) {
      blocks.push(
        <ul key={`l${blocks.length}`} className="space-y-1.5 pl-1">
          {listBuf.map((li, i) => (
            <li key={i} className="flex gap-2 text-sm leading-relaxed">
              <span className="text-primary/70 mt-1 shrink-0">›</span>
              <span className="flex-1">{renderInline(li)}</span>
            </li>
          ))}
        </ul>,
      );
      listBuf = [];
    }
  };
  const flushP = () => {
    if (pBuf.length > 0) {
      blocks.push(
        <p key={`p${blocks.length}`} className="leading-relaxed text-sm">
          {renderInline(pBuf.join(" "))}
        </p>,
      );
      pBuf = [];
    }
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushList();
      flushP();
      continue;
    }
    if (line.startsWith("### ")) {
      flushList();
      flushP();
      blocks.push(
        <h4 key={`h${blocks.length}`} className="text-[11px] uppercase tracking-wider font-semibold text-primary mt-3 first:mt-0">
          {renderInline(line.slice(4))}
        </h4>,
      );
      continue;
    }
    if (line.startsWith("## ")) {
      flushList();
      flushP();
      blocks.push(
        <h3 key={`h${blocks.length}`} className="text-sm font-semibold mt-3">
          {renderInline(line.slice(3))}
        </h3>,
      );
      continue;
    }
    if (line.startsWith("- ") || line.startsWith("* ")) {
      flushP();
      listBuf.push(line.slice(2));
    } else {
      flushList();
      pBuf.push(line);
    }
  }
  flushList();
  flushP();
  return <div className="space-y-2.5">{blocks}</div>;
}

function renderInline(s: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) parts.push(s.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) {
      parts.push(<strong key={key++} className="font-semibold text-foreground">{tok.slice(2, -2)}</strong>);
    } else {
      parts.push(<code key={key++} className="bg-muted/60 px-1 py-0.5 rounded text-xs font-mono">{tok.slice(1, -1)}</code>);
    }
    last = m.index + tok.length;
  }
  if (last < s.length) parts.push(s.slice(last));
  return parts;
}

export function WeeklyPlanCard() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<{ plan: WeeklyPlan | null }>({
    queryKey: ["weekly-plan"],
    queryFn: async () => {
      const res = await fetch("/api/coach/weekly-plan");
      if (!res.ok) throw new Error("weekly-plan");
      return res.json();
    },
    staleTime: 5 * 60_000,
  });

  const gen = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/coach/weekly-plan", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Wochenplan-Fehler");
      return body;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["weekly-plan"] }),
  });

  const plan = data?.plan;
  const weekStartDate = plan?.weekStart ? parseISO(plan.weekStart) : null;
  const weekStartLabel = weekStartDate ? format(weekStartDate, "d. MMM", { locale: de }) : null;
  const subtitle = plan && !plan.errorMessage
    ? `Woche ab ${weekStartLabel}${plan.isForCurrentWeek ? " (aktuell)" : ""} · erstellt ${format(parseISO(plan.generatedAt), "EEE HH:mm", { locale: de })}`
    : "Noch kein Wochenplan";

  const refreshBtn = (
    <Button
      size="sm"
      variant={plan ? "outline" : "default"}
      onClick={(e) => { e.stopPropagation(); gen.mutate(); }}
      disabled={gen.isPending}
    >
      <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", gen.isPending && "animate-spin")} />
      {gen.isPending ? "Plane..." : plan ? "Neu planen" : "Plan generieren"}
    </Button>
  );

  return (
    <CollapsibleCard
      icon={<CalendarRange className="h-4 w-4 text-primary shrink-0" />}
      title="Wochenplan"
      subtitle={subtitle}
      action={refreshBtn}
      defaultOpen={false}
    >
      <div className="space-y-5">
        {gen.error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-red-300">{gen.error instanceof Error ? gen.error.message : String(gen.error)}</p>
          </div>
        )}
        {plan?.errorMessage && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-red-300">{plan.errorMessage}</p>
          </div>
        )}

        {plan?.weekOverview && (
          <section>
            <h3 className="text-xs uppercase tracking-wider text-amber-400 font-medium mb-2">Wochen-Fokus</h3>
            <Markdown text={plan.weekOverview} />
          </section>
        )}
        {plan?.schedule && (
          <section>
            <h3 className="text-xs uppercase tracking-wider text-primary font-medium mb-2">Wochenplan</h3>
            <Markdown text={plan.schedule} />
          </section>
        )}
        {plan?.watchouts && (
          <section>
            <h3 className="text-xs uppercase tracking-wider text-blue-300 font-medium mb-2">Worauf achten</h3>
            <Markdown text={plan.watchouts} />
          </section>
        )}

        {!plan && !isLoading && !gen.isPending && (
          <div className="text-center py-6">
            <Sparkles className="h-8 w-8 text-primary/60 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              Noch kein Wochenplan. Generiert sich automatisch Sonntag 09:00, oder klick auf &quot;Plan generieren&quot;.
            </p>
          </div>
        )}
      </div>
    </CollapsibleCard>
  );
}

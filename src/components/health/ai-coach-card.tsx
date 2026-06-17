"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { CollapsibleCard } from "@/components/ui/collapsible-card";
import { Sparkles, RefreshCw, AlertTriangle, Sun, CloudSun, Moon, Activity, Sunrise } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { format, parseISO } from "date-fns";
import { de } from "@/lib/i18n/date-locale";

interface Recommendation {
  id: string;
  date: string;
  generatedAt: string;
  provider: string;
  model: string;
  phase: string | null;
  // Neue situational Sektionen
  statusFocus: string | null;
  actionsNow: string | null;
  eveningPrep: string | null;
  tomorrowSetup: string | null;
  // Legacy
  morningText: string | null;
  trainingPlan: string | null;
  watchOuts: string | null;
  afterTraining: string | null;
  adjustedScore: number | null;
  adjustedLevel: string | null;
  strengthIntensity: number | null;
  cardioIntensity: number | null;
  intensityReason: string | null;
  errorMessage: string | null;
}

function firstSentence(text: string | null): string {
  if (!text) return "";
  const cleaned = text.replace(/[#*`]/g, "").replace(/\s+/g, " ").trim();
  const m = cleaned.match(/^[^.!?]*[.!?]/);
  const s = m ? m[0].trim() : cleaned.slice(0, 140);
  return s.length > 140 ? s.slice(0, 137) + "..." : s;
}

function Markdown({ text }: { text: string }) {
  // Markdown-Renderer: ### Sub-Headlines, Absaetze, Bullets, fett + Zahlen-Highlight.
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
    // ### Sub-Headline
    if (line.startsWith("### ")) {
      flushList();
      flushP();
      blocks.push(
        <h4
          key={`h${blocks.length}`}
          className="text-[11px] uppercase tracking-wider font-semibold text-primary mt-3 first:mt-0"
        >
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
  // **bold** + `code`
  const parts: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) parts.push(s.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) {
      parts.push(
        <strong key={key++} className="font-semibold text-foreground">
          {tok.slice(2, -2)}
        </strong>,
      );
    } else {
      parts.push(
        <code key={key++} className="bg-muted/60 px-1 py-0.5 rounded text-xs font-mono">
          {tok.slice(1, -1)}
        </code>,
      );
    }
    last = m.index + tok.length;
  }
  if (last < s.length) parts.push(s.slice(last));
  return parts;
}

export function AiCoachCard() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<{ recommendation: Recommendation | null }>({
    queryKey: ["coach-recommendation"],
    queryFn: async () => {
      const res = await fetch("/api/coach/generate");
      if (!res.ok) throw new Error("recommendation");
      return res.json();
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
  });

  const gen = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/coach/generate", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "AI Coach Fehler");
      return body as Recommendation;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["coach-recommendation"] });
    },
  });

  const reco = data?.recommendation;
  const todayKey = format(new Date(), "yyyy-MM-dd");
  const isToday = reco?.date === todayKey;
  const stale = !reco || !isToday;

  const provider = reco?.provider === "nvidia" ? "Nvidia" : reco?.provider === "anthropic" ? "Anthropic" : reco?.provider;
  const subtitle = reco && !reco.errorMessage
    ? firstSentence(reco.statusFocus ?? reco.morningText) || `${provider} · ${format(parseISO(reco.generatedAt), "HH:mm")}`
    : stale ? "Noch keine Empfehlung heute" : "—";

  const refreshBtn = (
    <Button
      size="sm"
      variant={stale ? "default" : "outline"}
      onClick={(e) => { e.stopPropagation(); gen.mutate(); }}
      disabled={gen.isPending}
    >
      <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", gen.isPending && "animate-spin")} />
      {gen.isPending ? "Analysiere..." : stale ? "Jetzt analysieren" : "Aktualisieren"}
    </Button>
  );

  return (
    <CollapsibleCard
      icon={<Sparkles className="h-4 w-4 text-primary shrink-0" />}
      title={<span className="flex items-center gap-2">KI-Coach{reco?.phase && (
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-normal inline-flex items-center gap-1">
          {reco.phase === "morning" && <><Sunrise className="h-3 w-3 text-amber-400" /> Morgen</>}
          {reco.phase === "midday" && <><Activity className="h-3 w-3 text-primary" /> Mittag</>}
          {reco.phase === "evening" && <><Moon className="h-3 w-3 text-blue-300" /> Abend</>}
        </span>
      )}</span>}
      subtitle={subtitle}
      action={refreshBtn}
      defaultOpen={!stale && (reco?.statusFocus ?? null) !== null}
    >
      <div className="space-y-5">
        {gen.error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-red-300 font-medium">Fehler beim KI-Aufruf</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {gen.error instanceof Error ? gen.error.message : String(gen.error)}
              </p>
            </div>
          </div>
        )}
        {reco?.errorMessage && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-red-300 font-medium">Letzter Lauf fehlgeschlagen</p>
              <p className="text-xs text-muted-foreground mt-0.5">{reco.errorMessage}</p>
            </div>
          </div>
        )}

        {reco?.statusFocus && (
          <section>
            <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-2 flex items-center gap-1.5">
              <Sun className="h-3.5 w-3.5 text-amber-400" /> Status & Fokus
            </h3>
            <Markdown text={reco.statusFocus} />
          </section>
        )}

        {reco?.actionsNow && (
          <section>
            <h3 className="text-xs uppercase tracking-wider text-primary font-medium mb-2 flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5" /> Aktionen heute
            </h3>
            <Markdown text={reco.actionsNow} />
          </section>
        )}

        {reco?.eveningPrep && (
          <section>
            <h3 className="text-xs uppercase tracking-wider text-blue-300 font-medium mb-2 flex items-center gap-1.5">
              <CloudSun className="h-3.5 w-3.5" /> Heute Abend
            </h3>
            <Markdown text={reco.eveningPrep} />
          </section>
        )}

        {reco?.tomorrowSetup && (
          <section>
            <h3 className="text-xs uppercase tracking-wider text-emerald-400 font-medium mb-2 flex items-center gap-1.5">
              <Sunrise className="h-3.5 w-3.5" /> Setup morgen
            </h3>
            <Markdown text={reco.tomorrowSetup} />
          </section>
        )}

        {/* Fallback fuer alte Empfehlungen vor Schema-Update */}
        {!reco?.statusFocus && reco?.morningText && (
          <section>
            <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-2">Briefing</h3>
            <Markdown text={reco.morningText} />
          </section>
        )}
        {!reco?.actionsNow && reco?.trainingPlan && !reco?.statusFocus && (
          <section>
            <h3 className="text-xs uppercase tracking-wider text-primary font-medium mb-2">Trainings-Plan heute</h3>
            <Markdown text={reco.trainingPlan} />
          </section>
        )}
        {!reco?.eveningPrep && reco?.watchOuts && !reco?.statusFocus && (
          <section>
            <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-2">Worauf heute achten</h3>
            <Markdown text={reco.watchOuts} />
          </section>
        )}

        {reco?.adjustedScore !== null && reco?.adjustedScore !== undefined && (
          <div className="pt-2 border-t border-border/30 text-xs text-muted-foreground flex items-center gap-3">
            <span>
              KI-Adjustment: <span className="font-medium text-foreground">{reco.adjustedScore}</span>
              {reco.adjustedLevel && (
                <span className="ml-2 px-1.5 py-0.5 rounded bg-muted/50 text-foreground">{reco.adjustedLevel}</span>
              )}
            </span>
          </div>
        )}

        {!reco && !isLoading && !gen.isPending && (
          <div className="text-center py-6">
            <Sparkles className="h-8 w-8 text-primary/60 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              Noch keine KI-Empfehlung. Klick auf &quot;Jetzt analysieren&quot; um den Coach mit deinen Daten zu fuettern.
            </p>
          </div>
        )}
      </div>
    </CollapsibleCard>
  );
}

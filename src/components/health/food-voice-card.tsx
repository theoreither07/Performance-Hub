"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Mic, MicOff, Trash2, Utensils } from "lucide-react";

// Web Speech API Browser-Typen (TypeScript hat sie nicht in Default-Lib).
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    [index: number]: { transcript: string };
  }>;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
import { format, parseISO, subDays } from "date-fns";
import { de } from "@/lib/i18n/date-locale";

interface FoodEntry {
  date: string;
  content: string;
  updatedAt: string;
}

interface FoodResponse {
  entries: FoodEntry[];
}

export function FoodVoiceCard() {
  const qc = useQueryClient();
  const todayKey = format(new Date(), "yyyy-MM-dd");
  const yesterdayKey = format(subDays(new Date(), 1), "yyyy-MM-dd");
  // Default: HEUTE (intuitiver). User kann auf gestern wechseln wenn er morgens fuer Vortag fuellt.
  const [date, setDate] = React.useState<string>(todayKey);
  const [text, setText] = React.useState<string>("");

  const list = useQuery<FoodResponse>({
    queryKey: ["coach-food-memory"],
    queryFn: async () => {
      const res = await fetch("/api/coach/food-memory");
      if (!res.ok) throw new Error("food-memory-load");
      return res.json();
    },
    staleTime: 60_000,
  });

  // Wenn fuer das gewaehlte Datum schon ein Eintrag existiert, in die Textarea laden.
  // Aber: nach einem Save NICHT erneut laden (sonst Loop — der gerade gespeicherte
  // Eintrag würde sofort wieder in das geleerte Feld geladen).
  const justSavedRef = React.useRef(false);
  React.useEffect(() => {
    if (justSavedRef.current) {
      justSavedRef.current = false;
      return;
    }
    const existing = list.data?.entries.find((e) => e.date === date);
    setText(existing?.content ?? "");
  }, [date, list.data]);

  // Voice-Recording via Web Speech API (browser-native, kein extra API-Key).
  // Browsers: Chrome, Safari iOS 14.5+, Safari macOS 14.1+.
  const [recording, setRecording] = React.useState(false);
  const [supportsSpeech, setSupportsSpeech] = React.useState(false);
  const recognitionRef = React.useRef<SpeechRecognitionLike | null>(null);
  const baseTextRef = React.useRef<string>(""); // Text VOR Start der Recording-Session

  React.useEffect(() => {
    const win = window as unknown as { SpeechRecognition?: { new (): SpeechRecognitionLike }; webkitSpeechRecognition?: { new (): SpeechRecognitionLike } };
    setSupportsSpeech(!!(win.SpeechRecognition || win.webkitSpeechRecognition));
  }, []);

  const startRecording = () => {
    const win = window as unknown as { SpeechRecognition?: { new (): SpeechRecognitionLike }; webkitSpeechRecognition?: { new (): SpeechRecognitionLike } };
    const Ctor = win.SpeechRecognition ?? win.webkitSpeechRecognition;
    if (!Ctor) return;
    baseTextRef.current = text;
    const rec = new Ctor();
    rec.lang = "de-DE";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let interim = "";
      let finalText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      const sep = baseTextRef.current.length > 0 && !baseTextRef.current.endsWith(" ") ? " " : "";
      setText(baseTextRef.current + sep + finalText + interim);
      if (finalText) baseTextRef.current = baseTextRef.current + sep + finalText;
    };
    rec.onerror = (e) => {
      console.warn("[voice] error", e.error);
      setRecording(false);
    };
    rec.onend = () => {
      setRecording(false);
    };
    rec.start();
    recognitionRef.current = rec;
    setRecording(true);
  };

  const stopRecording = () => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
  };

  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/coach/food-memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, date }),
      });
      if (!res.ok) throw new Error("save");
      return res.json();
    },
    // Optimistic Update: Eintrag erscheint sofort in der UI, ohne auf Server-Roundtrip zu warten.
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ["coach-food-memory"] });
      const previous = qc.getQueryData<FoodResponse>(["coach-food-memory"]);
      qc.setQueryData<FoodResponse>(["coach-food-memory"], (old) => {
        const entries = (old?.entries ?? []).filter((e) => e.date !== date);
        return {
          entries: [{ date, content: text, updatedAt: new Date().toISOString() }, ...entries],
        };
      });
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      // Rollback bei Fehler
      if (ctx?.previous) qc.setQueryData(["coach-food-memory"], ctx.previous);
    },
    onSuccess: () => {
      // Nach erfolgreichem Speichern: Eingabefeld leeren + Date zurueck auf heute.
      // justSavedRef verhindert dass der nachfolgende list-refresh den geleerten
      // Text wieder mit dem gerade gespeicherten Eintrag befuellt.
      justSavedRef.current = true;
      setText("");
      setDate(todayKey);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["coach-food-memory"] });
    },
  });

  const del = useMutation({
    mutationFn: async (d: string) => {
      const res = await fetch(`/api/coach/food-memory?date=${d}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["coach-food-memory"] });
      setText("");
    },
  });

  const todayLabel = (() => {
    if (date === yesterdayKey) return "Gestern";
    if (date === format(new Date(), "yyyy-MM-dd")) return "Heute";
    return format(parseISO(date), "EEEE, d. MMM", { locale: de });
  })();

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 font-semibold">
            <Utensils className="h-3.5 w-3.5 text-primary" /> Food-Memory
          </p>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant={date === todayKey ? "default" : "outline"}
              className="h-7 text-xs px-2"
              onClick={() => setDate(todayKey)}
            >
              Heute
            </Button>
            <Button
              size="sm"
              variant={date === yesterdayKey ? "default" : "outline"}
              className="h-7 text-xs px-2"
              onClick={() => setDate(yesterdayKey)}
            >
              Gestern
            </Button>
            <input
              type="date"
              value={date}
              max={format(new Date(), "yyyy-MM-dd")}
              onChange={(e) => setDate(e.target.value)}
              className="h-7 rounded-md border border-border/40 bg-background px-2 text-xs tabular-nums"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] text-muted-foreground flex items-center gap-1.5">
            Was hast du <span className="text-foreground font-semibold">{todayLabel}</span> gegessen?
            {supportsSpeech && <span className="text-muted-foreground italic">(Mic-Button: Sprache → Text)</span>}
          </label>
          <div className="relative">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              placeholder="z.B. Frueh Skyr+Beeren, Mittag Reis+Hahn+Salat, Abend Pasta mit Tomatensauce, 2 Bier"
              className="w-full rounded-md border border-border/40 bg-background px-3 py-2 pr-12 text-sm leading-relaxed resize-y"
            />
            {supportsSpeech && (
              <button
                type="button"
                onClick={recording ? stopRecording : startRecording}
                className={`absolute top-2 right-2 h-8 w-8 rounded-full flex items-center justify-center transition-colors ${
                  recording ? "bg-red-500/20 text-red-300 animate-pulse" : "bg-primary/10 text-primary hover:bg-primary/20"
                }`}
                title={recording ? "Aufnahme stoppen" : "Aufnahme starten (deutsch)"}
                aria-label={recording ? "Aufnahme stoppen" : "Voice-Aufnahme starten"}
              >
                {recording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </button>
            )}
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] text-muted-foreground">
              {recording ? (
                <span className="text-red-300">● Aufnahme läuft — Text wird live übersetzt</span>
              ) : (
                "Coach liest das im Briefing — kein Kalorien-Tracking, nur Kontext."
              )}
            </p>
            <Button
              size="sm"
              onClick={() => save.mutate()}
              disabled={save.isPending || text.trim().length < 2 || recording}
              className="h-7 text-xs"
            >
              {save.isPending ? "Speichere..." : save.isSuccess ? "Gespeichert" : "Speichern"}
            </Button>
          </div>
        </div>

        {list.data?.entries && list.data.entries.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-border/30">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Letzte Eintraege</p>
            <ul className="space-y-1.5">
              {list.data.entries.slice(0, 5).map((e) => (
                <li key={e.date} className="text-xs flex items-start gap-2 group">
                  <span className="text-muted-foreground tabular-nums shrink-0 w-12">{format(parseISO(e.date), "d.M.")}</span>
                  <span className="text-foreground/90 flex-1 line-clamp-2 leading-snug">{e.content}</span>
                  <button
                    type="button"
                    onClick={() => del.mutate(e.date)}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                    aria-label={`Loeschen ${e.date}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

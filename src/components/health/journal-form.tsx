"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Pencil, Check } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { format } from "date-fns";

interface JournalEntry {
  id: string;
  date: string;
  mood: number | null;
  energy: number | null;
  motivation: number | null;
  soreness: number | null;
  workoutFelt: number | null;
  sleepQuality: number | null;
  ateWell: boolean | null;
  alcoholDrinks: number | null;
  notes: string | null;
  updatedAt: string;
}

interface Field {
  key: keyof Pick<JournalEntry, "mood" | "energy" | "motivation" | "soreness" | "sleepQuality">;
  label: string;
  hint?: string;
  invert?: boolean; // higher = worse (soreness)
}

// Workout-Gefuehl bewusst raus: das wird pro Training direkt in "Trainings heute" abgefragt (RPE/Gefuehl),
// hier waere es doppelt. Journal = subjektiver Tageszustand.
const FIELDS: Field[] = [
  { key: "mood", label: "Stimmung", hint: "1 = mies / 10 = top" },
  { key: "energy", label: "Energie" },
  { key: "motivation", label: "Motivation" },
  { key: "sleepQuality", label: "Schlafqualitaet (subj.)" },
  { key: "soreness", label: "Muskelkater", hint: "10 = stark", invert: true },
];

function Scale({
  value,
  onChange,
  invert = false,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  invert?: boolean;
}) {
  return (
    <div className="flex gap-1">
      {Array.from({ length: 10 }).map((_, i) => {
        const n = i + 1;
        const active = value !== null && n <= value;
        const goodSide = invert ? n <= 3 : n >= 7;
        const badSide = invert ? n >= 7 : n <= 3;
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange(value === n ? null : n)}
            className={cn(
              "h-7 flex-1 rounded text-[10px] font-medium border transition-all min-w-0",
              active
                ? goodSide
                  ? "bg-emerald-500/30 border-emerald-500/60 text-emerald-300"
                  : badSide
                    ? "bg-red-500/30 border-red-500/60 text-red-300"
                    : "bg-amber-500/30 border-amber-500/60 text-amber-300"
                : "bg-muted/30 border-border/40 text-muted-foreground hover:bg-muted/60",
            )}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}

export function JournalForm({ date, bare = false }: { date?: string; bare?: boolean }) {
  const todayKey = date ?? format(new Date(), "yyyy-MM-dd");
  const qc = useQueryClient();
  const { data } = useQuery<{ entry: JournalEntry | null }>({
    queryKey: ["journal", todayKey],
    queryFn: async () => {
      const res = await fetch(`/api/journal?date=${todayKey}`);
      if (!res.ok) throw new Error("journal");
      return res.json();
    },
    staleTime: 0,
    refetchOnMount: "always",
  });

  const [draft, setDraft] = React.useState<Partial<JournalEntry>>({});
  // editing=null waehrend Hydration, danach bool. Initial: form (true) wenn noch nichts da, compact (false) wenn schon was vorhanden.
  const [editing, setEditing] = React.useState<boolean | null>(null);
  const [savedAt, setSavedAt] = React.useState<Date | null>(null);
  const hydratedRef = React.useRef(false);
  const draftRef = React.useRef<Partial<JournalEntry>>({});
  const saveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hydrate genau einmal beim ersten erfolgreichen Load, danach gehoert der State dem User.
  // Vorher: useEffect re-hydratisierte bei jedem refetch -> hat unspeicherte aenderungen ueberschrieben.
  React.useEffect(() => {
    if (hydratedRef.current) return;
    if (data === undefined) return;
    const init = data.entry ?? {};
    setDraft(init);
    draftRef.current = init;
    // Compact wenn schon ein Eintrag, sonst Form
    setEditing(!data.entry);
    hydratedRef.current = true;
  }, [data]);

  // In-flight Save tracking + last-saved Snapshot
  const inFlightRef = React.useRef(false);
  const pendingSaveRef = React.useRef<Partial<JournalEntry> | null>(null);
  const [saveStatus, setSaveStatus] = React.useState<"idle" | "saving" | "saved" | "error">("idle");

  async function performSave(payload: Partial<JournalEntry>) {
    // Wenn schon ein Request offen ist, merken wir den neuesten Payload und feuern nach
    if (inFlightRef.current) {
      pendingSaveRef.current = payload;
      return;
    }
    inFlightRef.current = true;
    setSaveStatus("saving");
    try {
      const res = await fetch("/api/journal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ date: todayKey, ...payload }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const result = (await res.json()) as { entry: JournalEntry };
      setSavedAt(new Date());
      setSaveStatus("saved");
      // Cache mit Server-Antwort synchronisieren — so geht bei Re-Mount nach Tab-Wechsel nix verloren.
      qc.setQueryData(["journal", todayKey], { entry: result.entry });
      qc.invalidateQueries({ queryKey: ["health-score"] });
    } catch (err) {
      console.error("Journal save failed", err);
      setSaveStatus("error");
    } finally {
      inFlightRef.current = false;
      // Falls waehrend wir gewartet haben noch was reinkam → jetzt nachfeuern
      if (pendingSaveRef.current) {
        const next = pendingSaveRef.current;
        pendingSaveRef.current = null;
        performSave(next);
      }
    }
  }

  // Sofort-Save fuer Skalen-Klicks (kein Debounce — verlaesslich + last-write-wins via queue)
  function saveNow() {
    performSave(draftRef.current);
  }

  // Debounce nur fuer Text-Eingaben
  function saveDebounced() {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      performSave(draftRef.current);
    }, 800);
  }

  function setField<K extends keyof JournalEntry>(key: K, val: JournalEntry[K]) {
    // draftRef.current synchron updaten — verlaesslicher als auf functional setDraft-Callback zu warten
    const next = { ...draftRef.current, [key]: val };
    draftRef.current = next;
    setDraft(next);
    saveNow();
  }

  function setNotes(notes: string) {
    const next = { ...draftRef.current, notes };
    draftRef.current = next;
    setDraft(next);
    saveDebounced();
  }

  // Cleanup: ausstehenden Debounce-Save vor Unmount feuern
  React.useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        if (hydratedRef.current) performSave(draftRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Nach Hydration ist `draft` die Wahrheit (enthält auch laufende Edits die noch nicht zurückgesynct sind).
  // Fallback auf data.entry bevor hydratisiert wurde.
  const view = (hydratedRef.current ? draft : data?.entry) as Partial<JournalEntry> | null | undefined;
  const hasAnyValue = !!view && Object.entries(view).some(([k, v]) =>
    v !== null && v !== undefined && v !== "" && !["id", "date", "updatedAt"].includes(k),
  );
  // Compact ausschliesslich aus dem `editing`-State steuern. Vorher hatte ein erstmaliges Klicken
  // sofort `hasAnyValue=true` getriggert → automatisches Umschalten auf Compact mitten im Eintragen.
  // Solange wir nicht hydratisiert sind, zeigen wir das Form (vermeidet Layout-Flash).
  const isCompact = editing === false && hasAnyValue;

  if (isCompact && view) {
    const e = view;
    const chips: { label: string; value: string; tone: "good" | "bad" | "neutral" }[] = [];
    const pushScale = (label: string, v: number | null | undefined, invert = false) => {
      if (v === null || v === undefined) return;
      const tone: "good" | "bad" | "neutral" = invert
        ? v <= 3 ? "good" : v >= 7 ? "bad" : "neutral"
        : v >= 7 ? "good" : v <= 3 ? "bad" : "neutral";
      chips.push({ label, value: `${v}`, tone });
    };
    pushScale("Stimmung", e.mood);
    pushScale("Energie", e.energy);
    pushScale("Motivation", e.motivation);
    pushScale("Schlaf", e.sleepQuality);
    pushScale("Kater", e.soreness, true);
    if (e.ateWell !== null && e.ateWell !== undefined) {
      chips.push({ label: "Gestern Essen", value: e.ateWell ? "ok" : "schlecht", tone: e.ateWell ? "good" : "bad" });
    }
    if (e.alcoholDrinks !== null && e.alcoholDrinks !== undefined && e.alcoholDrinks > 0) {
      chips.push({ label: "Gestern Alk.", value: `${e.alcoholDrinks}`, tone: e.alcoholDrinks >= 3 ? "bad" : "neutral" });
    }
    const toneClass = (t: "good" | "bad" | "neutral") =>
      t === "good"
        ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
        : t === "bad"
          ? "bg-red-500/15 text-red-300 border-red-500/30"
          : "bg-muted/50 text-foreground border-border/40";

    const compactBody = (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium">Tages-Journal</p>
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)} className="h-7 -mr-2">
            <Pencil className="h-3.5 w-3.5 mr-1" /> Bearbeiten
          </Button>
        </div>
        {chips.length === 0 ? (
          <p className="text-sm text-muted-foreground">Eintrag vorhanden, aber keine Werte gesetzt.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <span key={c.label} className={cn("px-2 py-1 rounded-md text-xs font-medium border", toneClass(c.tone))}>
                {c.label} <span className="font-bold ml-0.5">{c.value}</span>
              </span>
            ))}
          </div>
        )}
        {e.notes && <p className="text-sm text-muted-foreground italic border-l-2 border-border pl-3">{e.notes}</p>}
      </div>
    );
    if (bare) return compactBody;
    return (
      <Card>
        <CardContent className="py-4">{compactBody}</CardContent>
      </Card>
    );
  }

  const saveStatusEl = (
    <span className={cn(
      "text-[10px] uppercase tracking-wider font-normal flex items-center gap-1",
      saveStatus === "error" ? "text-red-400" : saveStatus === "saving" ? "text-amber-400" : "text-muted-foreground",
    )}>
      {saveStatus === "saving" && "Speichere..."}
      {saveStatus === "saved" && savedAt && (
        <><Check className="h-3 w-3 text-emerald-400" /> Gespeichert {format(savedAt, "HH:mm:ss")}</>
      )}
      {saveStatus === "error" && "Fehler — bitte nochmal"}
      {saveStatus === "idle" && "Auto-Save"}
    </span>
  );

  const editBody = (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {FIELDS.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium">{f.label}</label>
                {f.hint && <span className="text-[10px] text-muted-foreground">{f.hint}</span>}
              </div>
              <Scale
                value={(draft[f.key] as number | null) ?? null}
                onChange={(v) => setField(f.key, v)}
                invert={f.invert}
              />
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Gestern gut & gesund gegessen?</label>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={draft.ateWell === true ? "default" : "outline"}
                onClick={() => setField("ateWell", draft.ateWell === true ? null : true)}
                className="flex-1"
              >
                Ja
              </Button>
              <Button
                type="button"
                size="sm"
                variant={draft.ateWell === false ? "default" : "outline"}
                onClick={() => setField("ateWell", draft.ateWell === false ? null : false)}
                className="flex-1"
              >
                Nein
              </Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Gestern Drinks?</label>
            <div className="flex gap-1">
              {[0, 1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setField("alcoholDrinks", draft.alcoholDrinks === n ? null : n)}
                  className={cn(
                    "h-8 flex-1 rounded text-xs font-medium border",
                    draft.alcoholDrinks === n ? "bg-primary text-primary-foreground border-primary" : "bg-muted/30 border-border/40",
                  )}
                >
                  {n === 5 ? "5+" : n}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium">Notizen</label>
          <Textarea
            value={draft.notes ?? ""}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => {
              if (saveTimerRef.current) {
                clearTimeout(saveTimerRef.current);
                saveTimerRef.current = null;
              }
              performSave(draftRef.current);
            }}
            placeholder="Was war heute besonders? Wie hat sich das Training angefuehlt?"
            rows={2}
            className="text-sm"
          />
        </div>

        {hasAnyValue && (
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                // letzte Aenderungen sofort flush'en + auf Compact wechseln
                if (saveTimerRef.current) {
                  clearTimeout(saveTimerRef.current);
                  saveTimerRef.current = null;
                }
                performSave(draftRef.current);
                setEditing(false);
              }}
            >
              <Check className="h-3.5 w-3.5 mr-1" /> Fertig
            </Button>
          </div>
        )}
    </div>
  );

  if (bare) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">Tages-Journal</p>
          {saveStatusEl}
        </div>
        {editBody}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between gap-2">
          <span>Tages-Journal</span>
          {saveStatusEl}
        </CardTitle>
      </CardHeader>
      <CardContent>{editBody}</CardContent>
    </Card>
  );
}

"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Target, Save, Check } from "lucide-react";

interface SlotPrefs {
  morningStart?: string;
  morningEnd?: string;
  noonPreferred?: string; // Mittag-Slot-Start
  noonEnd?: string;        // Mittag-Slot-Ende (neues Fenster-Ende)
  noonFallbacks?: string[];
  satLongStart?: string;
  satLongEnd?: string;
  sundayLightOnly?: boolean;
}

interface TrainingProfile {
  strengthPerWeek: number;
  runsPerWeek: number;
  longRunKm: number | null;
  shortRunKm: number | null;
  goals: string | null;
  maxHr: number | null;
  dailyCaloriesGoal: number | null;
  dailyStepsGoal: number | null;
  notes: string | null;
  weeklySlotPrefs: SlotPrefs | null;
  weeklyTemplateMarkdown: string | null;
}

const DEFAULT_SLOT_PREFS: SlotPrefs = {
  morningStart: "06:30",
  morningEnd: "08:30",
  noonPreferred: "13:30",
  noonEnd: "15:30",
  noonFallbacks: ["11:00", "16:00"],
  satLongStart: "09:00",
  satLongEnd: "12:00",
  sundayLightOnly: true,
};

const TEMPLATE_PLACEHOLDER = `## Ausdauer
- 2x Lauf 11km Z2 (<=150 bpm) — im Winter kann 1x davon Ergometer 1h sein
- 1x langer Cardio 2-3h (Lauf / Wandern / Fussball / aehnliche Aktivitaet)

## Kraft-Split (Mo-Fr)

### Mo — Beine schwer
- Beinpresse oder Kniebeugen 3-4 x 5-8 (schwer) — KEINE Squats wegen Ruecken
- Beinpresse oder Bulgarian Split Squats 3 x 6-10
- Deadlift oder Hip Thrust 3 x 5-8 (schwer)
- Beinbeuger 3 x 8-12
- Beinstrecker 3 x 8-12

### Di — Push
- Benchpress oder Maschine 3-4 x 5-8 (schwer)
- Chestpress oder Dips 3 x 8-10
- Military Press oder Handstand-Pushups 3 x 4-5
- Seitheben 3 x 8-10
- Chest Flys 3 x 8-10
- Triceps Pushdown

### Mi — Pull
- Klimmzuege mit Zusatzgewicht 3-4 x 5-8 (schwer)
- T-Bar Row 3-4 x 5-10
- Rudern Maschine/Seil 3 x 8
- Einarm Latzug 3 x 10
- Bizeps Curls am Seilzug 3 x 10

### Do — Beine light & athletic
- Beinpresse 3 x 8
- Box Jumps 4 x 4 (SS mit Kettlebell-Bauchdrehungen)
- Single-Leg Box Jumps 3 x 5
- Single-Leg Deadlifts SS Single-Leg Elevated Hip Thrust ohne Gewicht
- Leg Raises 3 x 10
- Optional Bein-Maschinen oder Dumbbell Snatches fuer Explosivitaet

### Fr — Brust + Ruecken
- SS Klimmzuege + Brustpresse 3 x 10 oder 3 x 6
- SS Rudern Ringe/Maschine + Dips 3 x 10
- T-Bar Row oder normales Rudern 3 x 10
- Chest Flys 3 x 10
- SS Liegestuetz + Ueberzuege als Burnout

### Fr-Alternative (wenn Beine leer ODER schon Brust+Ruecken-Workout): Schulter, Bauch, Arme
- 2x Schulter + 2x Bauch im Superset
- Hintere Schulter
- Bizeps + Trizeps
- 1x Schulter und Bauch-Uebung meistens schwerer

## Wichtig
- Sonntag = Light (Mobility / Spaziergang / lockeres Yoga) — Training nur im Notfall
- KEINE Kniebeugen (Rueckenproblem) — immer Alternativen`;

export function TrainingProfileForm() {
  const qc = useQueryClient();
  const { data } = useQuery<{ profile: TrainingProfile | null }>({
    queryKey: ["training-profile"],
    queryFn: async () => {
      const res = await fetch("/api/training-profile");
      if (!res.ok) throw new Error("profile");
      return res.json();
    },
  });

  const [form, setForm] = React.useState<TrainingProfile>({
    strengthPerWeek: 0,
    runsPerWeek: 0,
    longRunKm: null,
    shortRunKm: null,
    goals: "",
    maxHr: null,
    dailyCaloriesGoal: null,
    dailyStepsGoal: null,
    notes: "",
    weeklySlotPrefs: null,
    weeklyTemplateMarkdown: null,
  });
  const slot: SlotPrefs = { ...DEFAULT_SLOT_PREFS, ...(form.weeklySlotPrefs ?? {}) };
  const setSlot = (patch: Partial<SlotPrefs>) =>
    setForm({ ...form, weeklySlotPrefs: { ...slot, ...patch } });
  const [saved, setSaved] = React.useState(false);
  const hydratedRef = React.useRef(false);

  React.useEffect(() => {
    if (hydratedRef.current || !data) return;
    if (data.profile) setForm(data.profile);
    hydratedRef.current = true;
  }, [data]);

  const save = useMutation({
    mutationFn: async (payload: TrainingProfile) => {
      const res = await fetch("/api/training-profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("save profile");
      return res.json();
    },
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      qc.invalidateQueries({ queryKey: ["training-profile"] });
      qc.invalidateQueries({ queryKey: ["health-score"] });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Target className="h-4 w-4" /> Trainings-Plan & Ziele
        </CardTitle>
        <CardDescription>
          Wochenziele und Goals — werden vom KI-Trainer fuer Empfehlungen genutzt + im Dashboard als
          Fortschrittsanzeige.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Field
            label="Kraft / Woche"
            value={form.strengthPerWeek}
            onChange={(v) => setForm({ ...form, strengthPerWeek: Math.max(0, Math.min(14, Number(v) || 0)) })}
            type="number"
            hint="Anzahl Sessions"
          />
          <Field
            label="Laeufe / Woche"
            value={form.runsPerWeek}
            onChange={(v) => setForm({ ...form, runsPerWeek: Math.max(0, Math.min(14, Number(v) || 0)) })}
            type="number"
            hint="Anzahl Sessions"
          />
          <Field
            label="Kurzer Lauf (km)"
            value={form.shortRunKm ?? ""}
            onChange={(v) => setForm({ ...form, shortRunKm: v === "" ? null : Number(v) })}
            type="number"
            hint="z.B. 11"
          />
          <Field
            label="Langer Lauf (km)"
            value={form.longRunKm ?? ""}
            onChange={(v) => setForm({ ...form, longRunKm: v === "" ? null : Number(v) })}
            type="number"
            hint="z.B. 22"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field
            label="Max HR"
            value={form.maxHr ?? ""}
            onChange={(v) => setForm({ ...form, maxHr: v === "" ? null : Number(v) })}
            type="number"
            hint="z.B. 192"
          />
          <Field
            label="Kalorien-Tagesziel"
            value={form.dailyCaloriesGoal ?? ""}
            onChange={(v) => setForm({ ...form, dailyCaloriesGoal: v === "" ? null : Number(v) })}
            type="number"
            hint="Gesamtverbrauch, z.B. 3000"
          />
          <Field
            label="Schritte-Tagesziel"
            value={form.dailyStepsGoal ?? ""}
            onChange={(v) => setForm({ ...form, dailyStepsGoal: v === "" ? null : Number(v) })}
            type="number"
            hint="z.B. 15000"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium">Ziele</label>
          <Textarea
            value={form.goals ?? ""}
            onChange={(e) => setForm({ ...form, goals: e.target.value })}
            placeholder="z.B. VO2max verbessern, 5kg abnehmen, im Krafttraining staerker werden"
            rows={2}
            className="text-sm"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium">Notizen</label>
          <Textarea
            value={form.notes ?? ""}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="Was soll der Coach noch wissen? Verletzungen, Trainingstage, etc."
            rows={3}
            className="text-sm"
          />
        </div>

        {/* Wochenplaner Phase 1 — Slot-Praeferenzen */}
        <div className="space-y-3 pt-4 border-t border-border/40">
          <div>
            <h3 className="text-sm font-semibold">Bevorzugte Trainings-Slots</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Wann magst du normalerweise trainieren? Der Coach nutzt das fuer die Wochenplanung.
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Field label="Morgens Start" value={slot.morningStart ?? ""} onChange={(v) => setSlot({ morningStart: v })} type="time" hint="z.B. 06:30" />
            <Field label="Morgens Ende" value={slot.morningEnd ?? ""} onChange={(v) => setSlot({ morningEnd: v })} type="time" hint="Slot-Ende" />
            <Field label="Mittag Start" value={slot.noonPreferred ?? ""} onChange={(v) => setSlot({ noonPreferred: v })} type="time" hint="z.B. 13:30" />
            <Field label="Mittag Ende" value={slot.noonEnd ?? ""} onChange={(v) => setSlot({ noonEnd: v })} type="time" hint="z.B. 15:30 (Fenster)" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field
              label="Mittag-Fallbacks (wenn Hauptslot blockiert)"
              value={(slot.noonFallbacks ?? []).join(", ")}
              onChange={(v) => setSlot({ noonFallbacks: v.split(",").map((s) => s.trim()).filter((s) => /^\d{2}:\d{2}$/.test(s)) })}
              hint="z.B. 11:00, 16:00"
            />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Field label="Sa Long Start" value={slot.satLongStart ?? ""} onChange={(v) => setSlot({ satLongStart: v })} type="time" hint="z.B. 09:00" />
            <Field label="Sa Long Ende" value={slot.satLongEnd ?? ""} onChange={(v) => setSlot({ satLongEnd: v })} type="time" hint="z.B. 12:00" />
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Sonntag</label>
              <label className="flex items-center gap-2 h-9 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={slot.sundayLightOnly !== false}
                  onChange={(e) => setSlot({ sundayLightOnly: e.target.checked })}
                  className="h-4 w-4 rounded border-border"
                />
                Nur Light-Workouts (Notfall darf abweichen)
              </label>
            </div>
          </div>
        </div>

        {/* Wochenplaner Phase 1 — Trainings-Template */}
        <div className="space-y-2 pt-4 border-t border-border/40">
          <div>
            <h3 className="text-sm font-semibold">Aktuelles Trainings-Setup (Referenz fuer den Coach)</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Wie trainierst du aktuell? Splits, Cardio-Volumen, Default-Uebungen mit Reps. Markdown ist
              willkommen. Wenn du das aenderst (z.B. Fussballtraining startet wieder, Hypertrophie-Block
              endet), trag es hier ein — der Coach passt seine Plaene daran an.
            </p>
          </div>
          <Textarea
            value={form.weeklyTemplateMarkdown ?? ""}
            onChange={(e) => setForm({ ...form, weeklyTemplateMarkdown: e.target.value })}
            placeholder={TEMPLATE_PLACEHOLDER}
            rows={18}
            className="text-xs font-mono"
          />
          {!form.weeklyTemplateMarkdown && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setForm({ ...form, weeklyTemplateMarkdown: TEMPLATE_PLACEHOLDER })}
            >
              Vorlage uebernehmen
            </Button>
          )}
        </div>

        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Trage Trainings im Kalender als{" "}
            <code className="bg-muted px-1 py-0.5 rounded">Krafttraining: Oberkoerper</code> oder{" "}
            <code className="bg-muted px-1 py-0.5 rounded">Cardio: Laufen 11km</code> ein — werden automatisch erkannt.
          </p>
          <Button onClick={() => save.mutate(form)} disabled={save.isPending} size="sm">
            {saved ? <Check className="h-4 w-4 mr-1" /> : <Save className="h-4 w-4 mr-1" />}
            {saved ? "Gespeichert" : "Speichern"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  hint,
  fullWidth,
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  type?: string;
  hint?: string;
  fullWidth?: boolean;
}) {
  return (
    <div className={fullWidth ? "space-y-1.5" : "space-y-1.5"}>
      <label className="text-xs font-medium">{label}</label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} type={type} className="text-sm h-9" />
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

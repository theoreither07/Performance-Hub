"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dumbbell, Trash2, Plus, Save } from "lucide-react";

interface Lift {
  id: string;
  name: string;
  unit: string;
  current: number | null;
  currentReps: number | null;
  bestEver: number | null;
  notes: string | null;
  sortOrder: number;
}

export function KeyLiftsForm() {
  const qc = useQueryClient();
  const { data } = useQuery<{ lifts: Lift[] }>({
    queryKey: ["key-lifts"],
    queryFn: async () => {
      const res = await fetch("/api/key-lifts");
      if (!res.ok) throw new Error("lifts");
      return res.json();
    },
  });

  const save = useMutation({
    mutationFn: async (lift: Partial<Lift> & { name: string }) => {
      const res = await fetch("/api/key-lifts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(lift),
      });
      if (!res.ok) throw new Error("save");
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["key-lifts"] }),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/key-lifts?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete");
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["key-lifts"] }),
  });

  const lifts = data?.lifts ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Dumbbell className="h-4 w-4" /> Key-Lifts (Kraftwerte)
        </CardTitle>
        <CardDescription>
          Deine Strength-PRs werden vom KI-Coach in die Trainings-Empfehlungen einbezogen.
          Trag deine aktuellen Werte ein (Gewicht in kg oder Reps fuer Klimmzuege etc.). Notizen
          erklaeren Besonderheiten wie "kein Squat wegen Ruecken".
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {lifts.map((l) => (
          <LiftRow key={l.id} lift={l} onSave={(payload) => save.mutate(payload)} onDelete={() => del.mutate(l.id)} />
        ))}
        <NewLiftRow onAdd={(payload) => save.mutate(payload)} suggestedNames={["Bankdruecken", "Klimmzuege", "Military Press", "Deadlift", "Leg Press", "Hip Thrust"]} existing={lifts.map((l) => l.name)} />
      </CardContent>
    </Card>
  );
}

function LiftRow({
  lift,
  onSave,
  onDelete,
}: {
  lift: Lift;
  onSave: (l: Partial<Lift> & { name: string; id: string }) => void;
  onDelete: () => void;
}) {
  const [form, setForm] = React.useState({
    current: lift.current?.toString() ?? "",
    currentReps: lift.currentReps?.toString() ?? "",
    notes: lift.notes ?? "",
  });
  const [dirty, setDirty] = React.useState(false);

  function flush() {
    if (!dirty) return;
    onSave({
      id: lift.id,
      name: lift.name,
      unit: lift.unit as "kg" | "reps" | "bw",
      current: form.current === "" ? null : Number(form.current),
      currentReps: form.currentReps === "" ? null : Number(form.currentReps),
      notes: form.notes || null,
    });
    setDirty(false);
  }

  return (
    <div className="rounded-lg border border-border/40 bg-muted/20 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">{lift.name}</p>
        <Button variant="ghost" size="sm" onClick={onDelete} className="h-7 -mr-2 text-muted-foreground hover:text-red-400">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {lift.unit === "reps" ? "Reps" : "Gewicht (kg)"}
          </label>
          <Input
            type="number"
            value={form.current}
            onChange={(e) => { setForm({ ...form, current: e.target.value }); setDirty(true); }}
            onBlur={flush}
            className="h-9 text-sm"
          />
        </div>
        {lift.unit === "kg" && (
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Reps @ Gewicht</label>
            <Input
              type="number"
              placeholder="(optional)"
              value={form.currentReps}
              onChange={(e) => { setForm({ ...form, currentReps: e.target.value }); setDirty(true); }}
              onBlur={flush}
              className="h-9 text-sm"
            />
          </div>
        )}
        <div className={lift.unit === "kg" ? "space-y-1" : "col-span-2 space-y-1"}>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Notizen</label>
          <Input
            value={form.notes}
            onChange={(e) => { setForm({ ...form, notes: e.target.value }); setDirty(true); }}
            onBlur={flush}
            placeholder="z.B. selten / nur bei guter Form"
            className="h-9 text-sm"
          />
        </div>
      </div>
      {dirty && (
        <div className="flex justify-end">
          <Button size="sm" onClick={flush}>
            <Save className="h-3.5 w-3.5 mr-1" /> Speichern
          </Button>
        </div>
      )}
    </div>
  );
}

function NewLiftRow({
  onAdd,
  suggestedNames,
  existing,
}: {
  onAdd: (l: { name: string; unit: "kg" | "reps" | "bw"; current?: number | null; notes?: string | null }) => void;
  suggestedNames: string[];
  existing: string[];
}) {
  const [name, setName] = React.useState("");
  const [unit, setUnit] = React.useState<"kg" | "reps" | "bw">("kg");
  const [current, setCurrent] = React.useState("");
  const [notes, setNotes] = React.useState("");

  const missing = suggestedNames.filter((n) => !existing.includes(n));

  return (
    <div className="rounded-lg border border-dashed border-border/60 p-3 space-y-2">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">Neuer Lift</p>
      {missing.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {missing.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => {
                setName(n);
                setUnit(n.toLowerCase().includes("klimm") ? "reps" : "kg");
              }}
              className="text-[10px] px-2 py-0.5 rounded border border-border/40 hover:bg-muted/50 text-muted-foreground"
            >
              + {n}
            </button>
          ))}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
        <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} className="h-9 text-sm" />
        <select
          value={unit}
          onChange={(e) => setUnit(e.target.value as "kg" | "reps" | "bw")}
          className="h-9 text-sm rounded-md border border-border/40 bg-background px-2"
        >
          <option value="kg">kg</option>
          <option value="reps">reps</option>
          <option value="bw">bodyweight</option>
        </select>
        <Input
          type="number"
          placeholder="Wert"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          className="h-9 text-sm"
        />
        <Button
          onClick={() => {
            if (!name) return;
            onAdd({
              name,
              unit,
              current: current === "" ? null : Number(current),
              notes: notes || null,
            });
            setName("");
            setCurrent("");
            setNotes("");
          }}
          disabled={!name}
        >
          <Plus className="h-3.5 w-3.5 mr-1" /> Hinzufuegen
        </Button>
      </div>
      <Textarea
        placeholder="Notizen (optional, z.B. 'kein Squat wegen Rueckenproblemen')"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={1}
        className="text-sm"
      />
    </div>
  );
}

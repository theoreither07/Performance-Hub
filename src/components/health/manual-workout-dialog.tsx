"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

const TYPES: { value: string; label: string; hasDistance?: boolean }[] = [
  { value: "strength", label: "Krafttraining" },
  { value: "running", label: "Laufen", hasDistance: true },
  { value: "cycling", label: "Radfahren", hasDistance: true },
  { value: "swimming", label: "Schwimmen", hasDistance: true },
  { value: "yoga", label: "Yoga" },
  { value: "hiking", label: "Wandern", hasDistance: true },
  { value: "rowing", label: "Rudern", hasDistance: true },
  { value: "other", label: "Sonstiges" },
];

export function ManualWorkoutDialog({
  open,
  onClose,
  defaultDate,
}: {
  open: boolean;
  onClose: () => void;
  defaultDate: string;
}) {
  const qc = useQueryClient();
  const [date, setDate] = React.useState(defaultDate);
  const [time, setTime] = React.useState(format(new Date(), "HH:mm"));
  const [type, setType] = React.useState("strength");
  const [name, setName] = React.useState("");
  const [durationMin, setDurationMin] = React.useState("60");
  const [distanceKm, setDistanceKm] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  // Bei Wiederoeffnung Datum auf Default zuruecksetzen
  React.useEffect(() => {
    if (open) {
      setDate(defaultDate);
      setError(null);
    }
  }, [open, defaultDate]);

  const save = useMutation({
    mutationFn: async () => {
      const dur = parseInt(durationMin, 10);
      if (!dur || dur <= 0) throw new Error("Dauer in Minuten eingeben");
      const startTime = new Date(`${date}T${time || "00:00"}:00`);
      const body = {
        date,
        startTime: startTime.toISOString(),
        type,
        name: name.trim() || undefined,
        durationSec: dur * 60,
        distanceM: distanceKm ? Math.round(parseFloat(distanceKm) * 1000) : undefined,
        notes: notes.trim() || undefined,
      };
      const res = await fetch("/api/workouts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Speichern fehlgeschlagen (${res.status})`);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workouts"] });
      qc.invalidateQueries({ queryKey: ["health-score"] });
      // Reset Felder
      setName("");
      setDurationMin("60");
      setDistanceKm("");
      setNotes("");
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  const hasDistance = TYPES.find((t) => t.value === type)?.hasDistance ?? false;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Manuelles Training</DialogTitle>
          <DialogDescription>
            Trag ein Training nach, das nicht ueber Garmin synchronisiert wurde.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Datum</label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} max={format(new Date(), "yyyy-MM-dd")} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Uhrzeit (Start)</label>
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Art</label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Dauer (min)</label>
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                value={durationMin}
                onChange={(e) => setDurationMin(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium">Bezeichnung <span className="text-muted-foreground font-normal">(optional)</span></label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z.B. Push Day, Long Run"
            />
          </div>

          {hasDistance && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Distanz (km) <span className="text-muted-foreground font-normal">(optional)</span></label>
              <Input
                type="number"
                inputMode="decimal"
                step="0.1"
                min={0}
                value={distanceKm}
                onChange={(e) => setDistanceKm(e.target.value)}
              />
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-medium">Notizen <span className="text-muted-foreground font-normal">(optional)</span></label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Was war besonders?"
            />
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={save.isPending}>
              Abbrechen
            </Button>
            <Button type="button" onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? "Speichere..." : "Speichern"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

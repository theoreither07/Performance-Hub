"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const COLORS = ["#AAFF00", "#60A5FA", "#A78BFA", "#F472B6", "#FB923C", "#34D399", "#FCD34D"];

export function NewHabitDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [color, setColor] = React.useState(COLORS[0]);
  const [targetPerWeek, setTargetPerWeek] = React.useState(7);

  React.useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
      setColor(COLORS[0]);
      setTargetPerWeek(7);
    }
  }, [open]);

  const create = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/habits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          color,
          targetPerWeek,
        }),
      });
      if (!res.ok) throw new Error("create");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["habits"] });
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Neuer Habit</DialogTitle>
          <DialogDescription>Was willst du regelmaessig machen?</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            create.mutate();
          }}
          className="space-y-3"
        >
          <div>
            <label className="text-xs text-muted-foreground">Name</label>
            <Input
              autoFocus
              placeholder="z.B. Meditation, Sport, Lesen, Wasser trinken..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Beschreibung (optional)</label>
            <Textarea
              placeholder="Was genau? Warum wichtig?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Farbe</label>
            <div className="flex flex-wrap gap-2 mt-1">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className="h-8 w-8 rounded-md transition-transform hover:scale-110"
                  style={{
                    backgroundColor: c,
                    outline: color === c ? "2px solid white" : "none",
                    outlineOffset: "2px",
                  }}
                  aria-label={c}
                />
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Ziel: {targetPerWeek}x pro Woche</label>
            <input
              type="range"
              min={1}
              max={7}
              value={targetPerWeek}
              onChange={(e) => setTargetPerWeek(Number(e.target.value))}
              className="w-full mt-1 accent-primary"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>1x</span>
              <span>jeden Tag</span>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Abbrechen
            </Button>
            <Button type="submit" disabled={!name.trim() || create.isPending}>
              {create.isPending ? "Speichere..." : "Anlegen"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

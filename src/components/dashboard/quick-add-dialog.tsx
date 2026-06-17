"use client";

import * as React from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db/dexie";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createTodoLocal } from "@/lib/sync/local-mutations";
import { LIFE_AREAS, PRIORITIES, type LifeArea, type Priority } from "@/types/domain";
import { DueDatePicker } from "@/components/todos/due-date-picker";

const NO_PROJECT = "__none__";

const DURATIONS: { value: string; label: string }[] = [
  { value: "0", label: "Keine Angabe" },
  { value: "5", label: "5 Min" },
  { value: "15", label: "15 Min" },
  { value: "30", label: "30 Min" },
  { value: "60", label: "1 Stunde" },
  { value: "120", label: "2 Stunden" },
  { value: "240", label: "4 Stunden" },
  { value: "480", label: "Ganzer Tag" },
];

export function QuickAddDialog({
  open,
  onOpenChange,
  defaultArea,
  defaultProjectId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  defaultArea?: LifeArea;
  defaultProjectId?: string;
}) {
  const [title, setTitle] = React.useState("");
  const [area, setArea] = React.useState<LifeArea>(defaultArea ?? "PRIVATE");
  const [priority, setPriority] = React.useState<Priority>("MEDIUM");
  const [dueDate, setDueDate] = React.useState<string>("");
  const [duration, setDuration] = React.useState<string>("0");
  const [projectId, setProjectId] = React.useState<string>(defaultProjectId ?? NO_PROJECT);
  const [description, setDescription] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setArea(defaultArea ?? "PRIVATE");
      setProjectId(defaultProjectId ?? NO_PROJECT);
    }
  }, [open, defaultArea, defaultProjectId]);

  const projects = useLiveQuery(async () => {
    const all = await db.projects.toArray();
    return all.filter((p) => !p._deleted && p.area === area);
  }, [area]);

  const reset = () => {
    setTitle("");
    setPriority("MEDIUM");
    setDueDate("");
    setDuration("0");
    setDescription("");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      await createTodoLocal({
        title: title.trim(),
        area,
        priority,
        dueDate: dueDate || undefined,
        description: description || undefined,
        projectId: projectId === NO_PROJECT ? undefined : projectId,
        estimatedMinutes: duration === "0" ? undefined : Number(duration),
      });
      reset();
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Neue Aufgabe</DialogTitle>
          <DialogDescription>Schnell hinzufuegen. Wird lokal gespeichert und synchronisiert.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <Input
            autoFocus
            placeholder="Was steht an?"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Bereich</label>
              <Select value={area} onValueChange={(v) => setArea(v as LifeArea)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LIFE_AREAS.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Prioritaet</label>
              <Select value={priority} onValueChange={(v) => setPriority(v as Priority)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Projekt</label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PROJECT}>(Kein Projekt)</SelectItem>
                {projects?.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Faellig (optional)</label>
            <DueDatePicker value={dueDate} onChange={setDueDate} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Dauer (fuer Wochenplanung)</label>
            <Select value={duration} onValueChange={setDuration}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {DURATIONS.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Textarea placeholder="Notizen (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Abbrechen</Button>
            <Button type="submit" disabled={submitting || !title.trim()}>
              {submitting ? "Speichere..." : "Hinzufuegen"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

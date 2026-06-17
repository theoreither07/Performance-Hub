"use client";

import * as React from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type LocalTodo } from "@/lib/db/dexie";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { updateTodoLocal, deleteTodoLocal } from "@/lib/sync/local-mutations";
import { LIFE_AREAS, PRIORITIES, type LifeArea, type Priority, type TaskStatus } from "@/types/domain";
import { DueDatePicker } from "@/components/todos/due-date-picker";
import { Trash2 } from "lucide-react";

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

const STATUSES: { value: TaskStatus; label: string }[] = [
  { value: "TODO", label: "Offen" },
  { value: "IN_PROGRESS", label: "In Arbeit" },
  { value: "WAITING", label: "Wartet" },
  { value: "DONE", label: "Erledigt" },
  { value: "CANCELLED", label: "Abgebrochen" },
];

interface Props {
  todo: LocalTodo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function isoToLocalDatetime(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  // datetime-local braucht "YYYY-MM-DDTHH:mm" in LOCAL time
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

export function TodoEditDialog({ todo, open, onOpenChange }: Props) {
  const [title, setTitle] = React.useState(todo.title);
  const [area, setArea] = React.useState<LifeArea>(todo.area);
  const [priority, setPriority] = React.useState<Priority>(todo.priority);
  const [status, setStatus] = React.useState<TaskStatus>(todo.status);
  const [dueDate, setDueDate] = React.useState(isoToLocalDatetime(todo.dueDate));
  const [duration, setDuration] = React.useState(String(todo.estimatedMinutes ?? 0));
  const [projectId, setProjectId] = React.useState(todo.projectId ?? NO_PROJECT);
  const [description, setDescription] = React.useState(todo.description ?? "");
  const [submitting, setSubmitting] = React.useState(false);

  // Reset state wenn ein anderer Todo bearbeitet wird oder Dialog neu oeffnet
  React.useEffect(() => {
    if (open) {
      setTitle(todo.title);
      setArea(todo.area);
      setPriority(todo.priority);
      setStatus(todo.status);
      setDueDate(isoToLocalDatetime(todo.dueDate));
      setDuration(String(todo.estimatedMinutes ?? 0));
      setProjectId(todo.projectId ?? NO_PROJECT);
      setDescription(todo.description ?? "");
    }
  }, [open, todo]);

  const projects = useLiveQuery(async () => {
    const all = await db.projects.toArray();
    return all.filter((p) => !p._deleted && p.area === area);
  }, [area]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      await updateTodoLocal(todo.id, {
        title: title.trim(),
        area,
        priority,
        status,
        dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
        completedAt: status === "DONE" ? (todo.completedAt ?? new Date().toISOString()) : undefined,
        estimatedMinutes: duration === "0" ? undefined : Number(duration),
        projectId: projectId === NO_PROJECT ? undefined : projectId,
        description: description.trim() || undefined,
      });
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Diese Aufgabe wirklich loeschen?")) return;
    await deleteTodoLocal(todo.id);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Aufgabe bearbeiten</DialogTitle>
          <DialogDescription>Alle Felder, inkl. Projekt-Zuordnung und Status.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <Input
            autoFocus
            placeholder="Titel"
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
              <label className="text-xs text-muted-foreground">Status</label>
              <Select value={status} onValueChange={(v) => setStatus(v as TaskStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
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

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Prioritaet</label>
              <Select value={priority} onValueChange={(v) => setPriority(v as Priority)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Dauer</label>
              <Select value={duration} onValueChange={setDuration}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DURATIONS.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Faellig (optional)</label>
            <DueDatePicker value={dueDate} onChange={setDueDate} />
          </div>

          <div>
            <label className="text-xs text-muted-foreground">Notizen</label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </div>

          <div className="flex items-center justify-between gap-2 pt-2">
            <Button type="button" variant="ghost" size="sm" onClick={handleDelete} className="text-destructive hover:text-destructive">
              <Trash2 className="h-4 w-4 mr-1" /> Loeschen
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Abbrechen</Button>
              <Button type="submit" disabled={submitting || !title.trim()}>
                {submitting ? "Speichere..." : "Speichern"}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

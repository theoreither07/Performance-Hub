"use client";

import * as React from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type LocalTodo } from "@/lib/db/dexie";
import { setTodoProjectLocal } from "@/lib/sync/local-mutations";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { FolderKanban } from "lucide-react";
import { cn } from "@/lib/utils/cn";

const NO_PROJECT = "__none__";

/**
 * Kompakter Inline-Dropdown zum schnellen Zuweisen/Wechseln des Projekts —
 * ohne den vollen Edit-Dialog. Zeigt Projekte des jeweiligen Lebensbereichs.
 * stopPropagation, damit ein Klick nicht die umgebende Karte/Edit oeffnet.
 */
export function ProjectPicker({ todo, className }: { todo: LocalTodo; className?: string }) {
  const projects = useLiveQuery(async () => {
    const all = await db.projects.toArray();
    return all.filter((p) => !p._deleted && p.area === todo.area);
  }, [todo.area]);

  const current = projects?.find((p) => p.id === todo.projectId) ?? null;
  const value = todo.projectId ?? NO_PROJECT;

  const onChange = (v: string) => {
    void setTodoProjectLocal(todo.id, v === NO_PROJECT ? undefined : v);
  };

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        aria-label="Projekt zuweisen"
        className={cn(
          "h-6 w-auto gap-1 rounded-full border-border/50 bg-muted/40 px-2 py-0 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus:ring-1 focus:ring-offset-0",
          current && "text-foreground",
          className,
        )}
      >
        <FolderKanban className="h-3 w-3 shrink-0" style={{ color: current?.color ?? undefined }} />
        <span className="max-w-[10rem] truncate">{current ? current.name : "Projekt"}</span>
      </SelectTrigger>
      <SelectContent onClick={(e) => e.stopPropagation()}>
        <SelectItem value={NO_PROJECT}>(Kein Projekt)</SelectItem>
        {projects?.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

"use client";

import * as React from "react";
import { TodoCheckbox } from "@/components/ui/todo-checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Flag, Clock, CalendarClock, Pencil } from "lucide-react";
import { format } from "date-fns";
import { de } from "@/lib/i18n/date-locale";
import { db, type LocalTodo } from "@/lib/db/dexie";
import { toggleTodoLocal } from "@/lib/sync/local-mutations";
import { celebrateBig } from "@/lib/utils/celebrate";
import type { LifeArea } from "@/types/domain";
import { cn } from "@/lib/utils/cn";
import { TodoEditDialog } from "./todo-edit-dialog";
import { ProjectPicker } from "./project-picker";

const areaBadge: Record<LifeArea, "priv" | "fh" | "biz"> = {
  PRIVATE: "priv",
  FH: "fh",
  BUSINESS: "biz",
};

const areaLabel: Record<LifeArea, string> = {
  PRIVATE: "Privat",
  FH: "FH",
  BUSINESS: "Business",
};

function formatDuration(min?: number) {
  if (!min) return null;
  if (min < 60) return `${min} Min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function TodoRow({ todo, showArea = true }: { todo: LocalTodo; showArea?: boolean }) {
  const done = todo.status === "DONE";
  const [justCompleted, setJustCompleted] = React.useState(false);
  const [editOpen, setEditOpen] = React.useState(false);

  const overdue =
    !done && todo.dueDate && new Date(todo.dueDate) < new Date();

  const handleToggle = async (checked: boolean) => {
    if (checked && !done) {
      setJustCompleted(true);
      // Big celebration bei jeder 5. erledigten Aufgabe — kleines Reward
      try {
        const totalDone = await db.todos.where("status").equals("DONE").count();
        if ((totalDone + 1) % 5 === 0) celebrateBig();
      } catch {
        /* ignore */
      }
      setTimeout(() => setJustCompleted(false), 700);
    }
    await toggleTodoLocal(todo.id);
  };

  const duration = formatDuration(todo.estimatedMinutes);

  return (
    <>
    <div
      className={cn(
        "group flex items-start gap-3 py-3 px-2 -mx-2 rounded-lg border-b border-border/40 last:border-0",
        "transition-colors duration-200 hover:bg-accent/40",
        justCompleted && "animate-todo-complete",
        done && "opacity-60",
      )}
    >
      <div className="pt-0.5">
        <TodoCheckbox checked={done} onCheck={handleToggle} />
      </div>
      <div className="flex-1 min-w-0">
        <button
          type="button"
          onClick={() => setEditOpen(true)}
          className="text-left cursor-pointer w-full"
        >
          <p
            className={cn(
              "text-sm font-medium",
              done && "todo-strike text-muted-foreground",
            )}
          >
            {todo.title}
          </p>
        </button>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-1.5 text-xs text-muted-foreground">
          {todo.dueDate && (
            <span className={cn("flex items-center gap-1", overdue && "text-destructive font-medium")}>
              <CalendarClock className="h-3 w-3" />
              {format(new Date(todo.dueDate), "EEE, d. MMM HH:mm", { locale: de })}
            </span>
          )}
          {duration && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {duration}
            </span>
          )}
          <ProjectPicker todo={todo} />
        </div>
      </div>
      <div className="flex flex-col sm:flex-row items-end sm:items-center gap-1.5 shrink-0">
        {todo.priority === "URGENT" && (
          <Badge className="bg-destructive text-destructive-foreground">
            <Flag className="h-3 w-3 mr-0.5" /> Dringend
          </Badge>
        )}
        {todo.priority === "HIGH" && <Badge variant="outline">Hoch</Badge>}
        {showArea && <Badge variant={areaBadge[todo.area]}>{areaLabel[todo.area]}</Badge>}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 opacity-60 hover:opacity-100 transition-opacity"
          onClick={() => setEditOpen(true)}
          aria-label="Bearbeiten"
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
    <TodoEditDialog todo={todo} open={editOpen} onOpenChange={setEditOpen} />
    </>
  );
}

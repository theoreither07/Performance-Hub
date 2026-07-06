"use client";

import * as React from "react";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Flag, CalendarClock } from "lucide-react";
import { format } from "date-fns";
import { de } from "@/lib/i18n/date-locale";
import { TodoCheckbox } from "@/components/ui/todo-checkbox";
import { Badge } from "@/components/ui/badge";
import { db, type LocalTodo } from "@/lib/db/dexie";
import { toggleTodoLocal } from "@/lib/sync/local-mutations";
import { celebrateBig } from "@/lib/utils/celebrate";
import { cn } from "@/lib/utils/cn";
import { AREA_BADGE_VARIANT, AREA_LABEL } from "@/lib/utils/area-badge";
import { TodoEditDialog } from "./todo-edit-dialog";
import { ProjectPicker } from "./project-picker";

interface Props {
  todo: LocalTodo;
  showArea?: boolean;
  /** Im DragOverlay gerendert (kein eigenes Draggable, leicht gekippt). */
  overlay?: boolean;
  /** Original-Karte ausgrauen waehrend gezogen wird. */
  dimmed?: boolean;
}

export function TodoBoardCard({ todo, showArea = false, overlay = false, dimmed = false }: Props) {
  const [editOpen, setEditOpen] = React.useState(false);
  const done = todo.status === "DONE";

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: todo.id,
    disabled: overlay,
  });

  const overdue = !done && todo.dueDate && new Date(todo.dueDate) < new Date();

  const handleToggle = async (checked: boolean) => {
    if (checked && !done) {
      try {
        const totalDone = await db.todos.where("status").equals("DONE").count();
        if ((totalDone + 1) % 5 === 0) celebrateBig();
      } catch { /* ignore */ }
    }
    await toggleTodoLocal(todo.id);
  };

  const style = transform && !overlay ? { transform: CSS.Translate.toString(transform) } : undefined;

  return (
    <>
      <div
        ref={setNodeRef}
        style={style}
        className={cn(
          "rounded-lg border border-border/60 bg-card p-2.5",
          "transition-shadow",
          isDragging && "opacity-30",
          dimmed && "opacity-30",
          overlay && "rotate-[2deg] cursor-grabbing shadow-lg ring-1 ring-ring/40",
          done && !overlay && "opacity-60",
        )}
      >
        <div className="flex items-start gap-1.5">
          <button
            type="button"
            {...listeners}
            {...attributes}
            aria-label="Zum Verschieben ziehen"
            className="touch-none -ml-0.5 cursor-grab pt-0.5 text-muted-foreground/40 hover:text-muted-foreground active:cursor-grabbing"
          >
            <GripVertical className="h-4 w-4" />
          </button>
          <div className="pt-0.5">
            <TodoCheckbox checked={done} onCheck={handleToggle} />
          </div>
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            className="min-w-0 flex-1 text-left"
          >
            <p className={cn("text-sm font-medium leading-snug break-words", done && "todo-strike text-muted-foreground")}>
              {todo.title}
            </p>
          </button>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-6">
          {todo.priority === "URGENT" && (
            <Badge className="bg-destructive text-destructive-foreground">
              <Flag className="mr-0.5 h-3 w-3" /> Dringend
            </Badge>
          )}
          {todo.priority === "HIGH" && <Badge variant="outline">Hoch</Badge>}
          {showArea && <Badge variant={AREA_BADGE_VARIANT[todo.area]}>{AREA_LABEL[todo.area]}</Badge>}
          {todo.dueDate && (
            <span className={cn("inline-flex items-center gap-1 text-xs text-muted-foreground", overdue && "font-medium text-destructive")}>
              <CalendarClock className="h-3 w-3" />
              {format(new Date(todo.dueDate), "d. MMM", { locale: de })}
            </span>
          )}
          <ProjectPicker todo={todo} />
        </div>
      </div>
      {!overlay && <TodoEditDialog todo={todo} open={editOpen} onOpenChange={setEditOpen} />}
    </>
  );
}

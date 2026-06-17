"use client";

import * as React from "react";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
  closestCorners,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { type LocalTodo } from "@/lib/db/dexie";
import { setTodoStatusLocal } from "@/lib/sync/local-mutations";
import { BOARD_COLUMNS, isBoardStatus, sortBoardTodos, sortDoneTodos, type BoardColumn } from "@/lib/todos/board";
import { cn } from "@/lib/utils/cn";
import { TodoBoardCard } from "./todo-board-card";

export function TodoBoard({ todos, showArea = false }: { todos: LocalTodo[]; showArea?: boolean }) {
  const [activeId, setActiveId] = React.useState<string | null>(null);

  // MouseSensor (Desktop, kleine Aktivierungs-Distanz gegen Fehl-Drags beim Klick) +
  // TouchSensor (Mobile, kurze Press-Verzoegerung damit vertikales Scrollen weiter geht).
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 140, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const byStatus = React.useMemo(() => {
    const map: Record<BoardColumn["status"], LocalTodo[]> = {
      TODO: [], IN_PROGRESS: [], WAITING: [], DONE: [],
    };
    for (const t of todos) {
      if (!isBoardStatus(t.status)) continue; // CANCELLED u.ae. nicht im Board
      map[t.status].push(t);
    }
    map.TODO.sort(sortBoardTodos);
    map.IN_PROGRESS.sort(sortBoardTodos);
    map.WAITING.sort(sortBoardTodos);
    map.DONE.sort(sortDoneTodos);
    return map;
  }, [todos]);

  const active = activeId ? todos.find((t) => t.id === activeId) ?? null : null;

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const overId = e.over?.id;
    if (overId == null) return;
    const newStatus = String(overId);
    if (!isBoardStatus(newStatus)) return;
    const todo = todos.find((t) => t.id === String(e.active.id));
    if (!todo || todo.status === newStatus) return;
    void setTodoStatusLocal(todo.id, newStatus);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 snap-x snap-mandatory">
        {BOARD_COLUMNS.map((col) => (
          <Column key={col.status} col={col} todos={byStatus[col.status]} showArea={showArea} activeId={activeId} />
        ))}
      </div>
      <DragOverlay dropAnimation={null}>
        {active ? <TodoBoardCard todo={active} showArea={showArea} overlay /> : null}
      </DragOverlay>
    </DndContext>
  );
}

function Column({
  col,
  todos,
  showArea,
  activeId,
}: {
  col: BoardColumn;
  todos: LocalTodo[];
  showArea: boolean;
  activeId: string | null;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: col.status });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex w-[80vw] max-w-[300px] shrink-0 snap-start flex-col rounded-xl border border-border/50 bg-muted/20 sm:w-72",
        isOver && "border-ring/60 bg-accent/30 ring-2 ring-ring/40",
      )}
    >
      <header className="flex items-center justify-between border-b border-border/40 px-3 py-2">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <span className="h-2 w-2 rounded-full" style={{ background: col.accent }} />
          {col.label}
        </span>
        <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground">{todos.length}</span>
      </header>
      <div className="flex min-h-[64px] flex-col gap-2 p-2">
        {todos.length === 0 && (
          <p className="py-6 text-center text-xs text-muted-foreground/50">Hierher ziehen</p>
        )}
        {todos.map((t) => (
          <TodoBoardCard key={t.id} todo={t} showArea={showArea} dimmed={activeId === t.id} />
        ))}
      </div>
    </div>
  );
}

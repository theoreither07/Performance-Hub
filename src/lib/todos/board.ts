// Kanban-Board-Konfiguration + Sortier-Helfer.
// Pure (kein React/Dexie) damit testbar + auch serverseitig nutzbar.

import type { TaskStatus, Priority } from "@/types/domain";

export interface BoardColumn {
  status: Extract<TaskStatus, "TODO" | "IN_PROGRESS" | "WAITING" | "DONE">;
  label: string;
  accent: string; // Punkt-Farbe in der Spaltenkopfzeile
}

// CANCELLED ist bewusst KEINE Board-Spalte (selten, bleibt nur im Edit-Dialog erreichbar).
export const BOARD_COLUMNS: BoardColumn[] = [
  { status: "TODO", label: "To Do", accent: "#9CA3AF" },
  { status: "IN_PROGRESS", label: "In Arbeit", accent: "#60A5FA" },
  { status: "WAITING", label: "Wartet", accent: "#F59E0B" },
  { status: "DONE", label: "Erledigt", accent: "#34D399" },
];

export const BOARD_STATUSES = BOARD_COLUMNS.map((c) => c.status) as readonly BoardColumn["status"][];

export function isBoardStatus(s: string): s is BoardColumn["status"] {
  return (BOARD_STATUSES as readonly string[]).includes(s);
}

const PRIORITY_RANK: Record<Priority, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

interface SortableTodo {
  priority: Priority;
  dueDate?: string;
  createdAt: string;
}

/** Offene Spalten (TODO/IN_PROGRESS/WAITING): nach Prioritaet, dann Faelligkeit, dann neueste zuerst. */
export function sortBoardTodos(a: SortableTodo, b: SortableTodo): number {
  const pr = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (pr !== 0) return pr;
  const da = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
  const dbb = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
  if (da !== dbb) return da - dbb;
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

interface DoneTodo {
  completedAt?: string;
  updatedAt: string;
}

/** Erledigt-Spalte: zuletzt abgeschlossene zuerst. */
export function sortDoneTodos(a: DoneTodo, b: DoneTodo): number {
  const ta = new Date(a.completedAt ?? a.updatedAt).getTime();
  const tb = new Date(b.completedAt ?? b.updatedAt).getTime();
  return tb - ta;
}

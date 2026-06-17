import Dexie, { type Table } from "dexie";
import type { LifeArea, Priority, TaskStatus } from "@/types/domain";

export interface LocalTodo {
  id: string;             // server ID (cuid) ODER clientId solange noch nicht synchronisiert
  clientId: string;       // immer gesetzt, bleibt stabil
  area: LifeArea;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: Priority;
  dueDate?: string;       // ISO
  completedAt?: string;
  projectId?: string;
  estimatedMinutes?: number;
  createdAt: string;
  updatedAt: string;
  // Sync-Meta
  _dirty: 0 | 1;          // 1 = muss zum Server gepusht werden
  _deleted: 0 | 1;
  _syncedAt?: string;
}

export interface LocalProject {
  id: string;
  clientId: string;
  area: LifeArea;
  name: string;
  description?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  color?: string;
  icon?: string;
  status: TaskStatus;
  startDate?: string;
  dueDate?: string;
  createdAt: string;
  updatedAt: string;
  _dirty: 0 | 1;
  _deleted: 0 | 1;
  _syncedAt?: string;
}

export interface OutboxEntry {
  id?: number;
  entity: "todo" | "project";
  entityClientId: string;
  operation: "CREATE" | "UPDATE" | "DELETE";
  payload: unknown;
  queuedAt: string;
  attempts: number;
  lastError?: string;
}

export interface MetaEntry {
  key: string;
  value: unknown;
  updatedAt: string;
}

class DashboardDB extends Dexie {
  todos!: Table<LocalTodo, string>;
  projects!: Table<LocalProject, string>;
  outbox!: Table<OutboxEntry, number>;
  meta!: Table<MetaEntry, string>;

  constructor() {
    super("personal-dashboard");
    this.version(1).stores({
      todos: "id, clientId, area, status, dueDate, projectId, _dirty",
      projects: "id, clientId, area, status, _dirty",
      outbox: "++id, entity, entityClientId, queuedAt",
      meta: "key",
    });
    // v2: estimatedMinutes hinzugefuegt (Schema-Change reicht — neue Spalten brauchen keinen Index)
    this.version(2).stores({
      todos: "id, clientId, area, status, dueDate, projectId, _dirty, estimatedMinutes",
      projects: "id, clientId, area, status, _dirty",
      outbox: "++id, entity, entityClientId, queuedAt",
      meta: "key",
    });
  }
}

export const db = new DashboardDB();

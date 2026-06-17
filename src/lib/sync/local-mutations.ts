import { db, type LocalTodo, type LocalProject } from "@/lib/db/dexie";
import { enqueue } from "./sync-engine";
import type { LifeArea, Priority, TaskStatus } from "@/types/domain";

function uid() {
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function nowIso() {
  return new Date().toISOString();
}

// ---------- Todos ----------

export async function createTodoLocal(input: {
  title: string;
  area: LifeArea;
  priority?: Priority;
  dueDate?: string;
  description?: string;
  projectId?: string;
  estimatedMinutes?: number;
}): Promise<LocalTodo> {
  const clientId = uid();
  const todo: LocalTodo = {
    id: clientId,
    clientId,
    area: input.area,
    title: input.title,
    description: input.description,
    status: "TODO",
    priority: input.priority ?? "MEDIUM",
    dueDate: input.dueDate,
    projectId: input.projectId,
    estimatedMinutes: input.estimatedMinutes,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    _dirty: 1,
    _deleted: 0,
  };
  await db.todos.put(todo);
  await enqueue({ entity: "todo", entityClientId: clientId, operation: "CREATE", payload: todo });
  return todo;
}

export async function updateTodoLocal(id: string, patch: Partial<LocalTodo>): Promise<void> {
  const existing = await db.todos.get(id);
  if (!existing) return;
  const updated: LocalTodo = {
    ...existing,
    ...patch,
    updatedAt: nowIso(),
    _dirty: 1,
  };
  await db.todos.put(updated);
  await enqueue({
    entity: "todo",
    entityClientId: existing.clientId,
    operation: "UPDATE",
    payload: updated,
  });
}

export async function toggleTodoLocal(id: string): Promise<void> {
  const existing = await db.todos.get(id);
  if (!existing) return;
  const done = existing.status !== "DONE";
  await updateTodoLocal(id, {
    status: done ? "DONE" : "TODO",
    completedAt: done ? nowIso() : undefined,
  });
}

/** Status setzen (z.B. Kanban-Drag) — completedAt wird passend gesetzt/geleert. */
export async function setTodoStatusLocal(id: string, status: TaskStatus): Promise<void> {
  const existing = await db.todos.get(id);
  if (!existing) return;
  if (existing.status === status) return;
  await updateTodoLocal(id, {
    status,
    completedAt: status === "DONE" ? (existing.completedAt ?? nowIso()) : undefined,
  });
}

/** Projekt schnell zuweisen/entfernen (Inline-Dropdown). */
export async function setTodoProjectLocal(id: string, projectId: string | undefined): Promise<void> {
  const existing = await db.todos.get(id);
  if (!existing) return;
  if ((existing.projectId ?? undefined) === (projectId ?? undefined)) return;
  await updateTodoLocal(id, { projectId });
}

export async function deleteTodoLocal(id: string): Promise<void> {
  const existing = await db.todos.get(id);
  if (!existing) return;
  await db.todos.update(id, { _deleted: 1, _dirty: 1, updatedAt: nowIso() });
  await enqueue({
    entity: "todo",
    entityClientId: existing.clientId,
    operation: "DELETE",
    payload: { id: existing.id },
  });
}

// ---------- Projects ----------

export async function createProjectLocal(input: {
  name: string;
  area: LifeArea;
  description?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  color?: string;
  icon?: string;
}): Promise<LocalProject> {
  const clientId = uid();
  const project: LocalProject = {
    id: clientId,
    clientId,
    area: input.area,
    name: input.name,
    description: input.description,
    contactName: input.contactName,
    contactEmail: input.contactEmail,
    contactPhone: input.contactPhone,
    color: input.color,
    icon: input.icon,
    status: "IN_PROGRESS",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    _dirty: 1,
    _deleted: 0,
  };
  await db.projects.put(project);
  await enqueue({ entity: "project", entityClientId: clientId, operation: "CREATE", payload: project });
  return project;
}

export async function updateProjectLocal(id: string, patch: Partial<LocalProject>): Promise<void> {
  const existing = await db.projects.get(id);
  if (!existing) return;
  const updated: LocalProject = { ...existing, ...patch, updatedAt: nowIso(), _dirty: 1 };
  await db.projects.put(updated);
  await enqueue({
    entity: "project",
    entityClientId: existing.clientId,
    operation: "UPDATE",
    payload: updated,
  });
}

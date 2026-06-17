import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getCurrentUser } from "@/lib/api/get-user";

function serializeTodo(t: Awaited<ReturnType<typeof prisma.todo.findMany>>[number]) {
  return {
    id: t.id,
    clientId: t.clientId ?? t.id,
    area: t.area,
    title: t.title,
    description: t.description ?? undefined,
    status: t.status,
    priority: t.priority,
    dueDate: t.dueDate?.toISOString(),
    completedAt: t.completedAt?.toISOString(),
    projectId: t.projectId ?? undefined,
    estimatedMinutes: t.estimatedMinutes ?? undefined,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    _dirty: 0,
    _deleted: 0,
  };
}

function serializeProject(p: Awaited<ReturnType<typeof prisma.project.findMany>>[number]) {
  return {
    id: p.id,
    clientId: p.clientId ?? p.id,
    area: p.area,
    name: p.name,
    description: p.description ?? undefined,
    contactName: p.contactName ?? undefined,
    contactEmail: p.contactEmail ?? undefined,
    contactPhone: p.contactPhone ?? undefined,
    color: p.color ?? undefined,
    icon: p.icon ?? undefined,
    status: p.status,
    startDate: p.startDate?.toISOString(),
    dueDate: p.dueDate?.toISOString(),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    _dirty: 0,
    _deleted: 0,
  };
}

export async function GET(req: Request) {
  const user = await getCurrentUser();
  const { searchParams } = new URL(req.url);
  const sinceParam = searchParams.get("since");
  const since = sinceParam ? new Date(sinceParam) : null;

  const todos = await prisma.todo.findMany({
    where: { userId: user.id, ...(since ? { updatedAt: { gt: since } } : {}) },
    orderBy: { updatedAt: "asc" },
    take: 500,
  });
  const projects = await prisma.project.findMany({
    where: { userId: user.id, ...(since ? { updatedAt: { gt: since } } : {}) },
    orderBy: { updatedAt: "asc" },
    take: 200,
  });

  // Geloeschte: aus SyncLog ableiten (Eintraege mit operation=DELETE seit `since`)
  let deletedTodoIds: string[] = [];
  let deletedProjectIds: string[] = [];
  if (since) {
    const deletes = await prisma.syncLog.findMany({
      where: { userId: user.id, operation: "DELETE", syncedAt: { gt: since } },
      select: { entity: true, entityId: true },
    });
    deletedTodoIds = deletes.filter((d) => d.entity === "todo").map((d) => d.entityId);
    deletedProjectIds = deletes.filter((d) => d.entity === "project").map((d) => d.entityId);
  }

  return NextResponse.json({
    serverTime: new Date().toISOString(),
    todos: todos.map(serializeTodo),
    projects: projects.map(serializeProject),
    deletedTodoIds,
    deletedProjectIds,
  });
}

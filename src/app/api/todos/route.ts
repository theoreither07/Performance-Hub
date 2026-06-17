/**
 * GET /api/todos — Web-UI Todos (Session-Auth).
 * Web-App benutzt sonst Dexie-Offline-First, aber für Daily Coach + MorningRitual brauchen wir
 * Server-Side ein einfaches Listing.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getCurrentUser } from "@/lib/api/get-user";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") ?? "open";
  const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") ?? "50")));

  const where = {
    userId: user.id,
    deletedAt: null,
    ...(status === "open" ? { completedAt: null } : {}),
  };

  const todos = await prisma.todo.findMany({
    where,
    orderBy: [
      { priority: "asc" },
      { dueDate: "asc" },
      { createdAt: "desc" },
    ],
    take: limit,
  });

  return NextResponse.json({
    items: todos.map((t) => ({
      id: t.id,
      title: t.title,
      completed: !!t.completedAt,
      due: t.dueDate ? t.dueDate.toISOString() : null,
      priority: t.priority,
      projectId: t.projectId,
      area: t.area,
    })),
  });
}

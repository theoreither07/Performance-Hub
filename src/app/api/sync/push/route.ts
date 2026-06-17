import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getCurrentUser } from "@/lib/api/get-user";

const pushSchema = z.object({
  entity: z.enum(["todo", "project"]),
  entityClientId: z.string(),
  operation: z.enum(["CREATE", "UPDATE", "DELETE"]),
  payload: z.any(),
});

export async function POST(req: Request) {
  const user = await getCurrentUser();
  const body = pushSchema.parse(await req.json());

  if (body.entity === "todo") {
    if (body.operation === "CREATE") {
      const p = body.payload as Record<string, unknown>;
      const todo = await prisma.todo.create({
        data: {
          userId: user.id,
          clientId: body.entityClientId,
          title: String(p.title ?? ""),
          description: (p.description as string | undefined) ?? null,
          area: p.area as "PRIVATE" | "FH" | "BUSINESS",
          priority: (p.priority as "LOW" | "MEDIUM" | "HIGH" | "URGENT") ?? "MEDIUM",
          status: (p.status as "TODO" | "IN_PROGRESS" | "WAITING" | "DONE" | "CANCELLED") ?? "TODO",
          dueDate: p.dueDate ? new Date(p.dueDate as string) : null,
          projectId: (p.projectId as string | undefined) ?? null,
          estimatedMinutes: (p.estimatedMinutes as number | undefined) ?? null,
        },
      });
      await prisma.syncLog.create({
        data: {
          userId: user.id,
          entity: "todo",
          entityId: todo.id,
          operation: "CREATE",
          payload: p as any,
          clientId: body.entityClientId,
        },
      });
      return NextResponse.json({ id: todo.id, updatedAt: todo.updatedAt.toISOString() });
    }
    if (body.operation === "UPDATE") {
      const p = body.payload as Record<string, unknown>;
      const existing = await prisma.todo.findFirst({
        where: { OR: [{ id: p.id as string }, { clientId: body.entityClientId }], userId: user.id },
      });
      if (!existing) {
        return NextResponse.json({ error: "not_found" }, { status: 404 });
      }
      // Last-Write-Wins
      const clientUpdatedAt = p.updatedAt ? new Date(p.updatedAt as string) : new Date(0);
      if (existing.updatedAt > clientUpdatedAt) {
        return NextResponse.json({ id: existing.id, updatedAt: existing.updatedAt.toISOString(), conflict: true });
      }
      const updated = await prisma.todo.update({
        where: { id: existing.id },
        data: {
          title: p.title ? String(p.title) : undefined,
          description: p.description !== undefined ? (p.description as string | null) : undefined,
          status: p.status as any,
          priority: p.priority as any,
          dueDate: p.dueDate ? new Date(p.dueDate as string) : null,
          completedAt: p.completedAt ? new Date(p.completedAt as string) : null,
          projectId: (p.projectId as string | undefined) ?? null,
          estimatedMinutes: (p.estimatedMinutes as number | undefined) ?? null,
        },
      });
      return NextResponse.json({ id: updated.id, updatedAt: updated.updatedAt.toISOString() });
    }
    if (body.operation === "DELETE") {
      const existing = await prisma.todo.findFirst({
        where: { OR: [{ id: (body.payload as any)?.id }, { clientId: body.entityClientId }], userId: user.id },
      });
      if (existing) {
        await prisma.todo.delete({ where: { id: existing.id } });
      }
      return NextResponse.json({ id: existing?.id ?? body.entityClientId, updatedAt: new Date().toISOString() });
    }
  }

  if (body.entity === "project") {
    if (body.operation === "CREATE") {
      const p = body.payload as Record<string, unknown>;
      const project = await prisma.project.create({
        data: {
          userId: user.id,
          clientId: body.entityClientId,
          name: String(p.name ?? ""),
          description: (p.description as string | undefined) ?? null,
          contactName: (p.contactName as string | undefined) ?? null,
          contactEmail: (p.contactEmail as string | undefined) ?? null,
          contactPhone: (p.contactPhone as string | undefined) ?? null,
          area: p.area as any,
          color: (p.color as string | undefined) ?? null,
          icon: (p.icon as string | undefined) ?? null,
        },
      });
      return NextResponse.json({ id: project.id, updatedAt: project.updatedAt.toISOString() });
    }
    if (body.operation === "UPDATE") {
      const p = body.payload as Record<string, unknown>;
      const existing = await prisma.project.findFirst({
        where: { OR: [{ id: p.id as string }, { clientId: body.entityClientId }], userId: user.id },
      });
      if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
      const updated = await prisma.project.update({
        where: { id: existing.id },
        data: {
          name: p.name ? String(p.name) : undefined,
          description: p.description !== undefined ? (p.description as string | null) : undefined,
          contactName: p.contactName !== undefined ? (p.contactName as string | null) : undefined,
          contactEmail: p.contactEmail !== undefined ? (p.contactEmail as string | null) : undefined,
          contactPhone: p.contactPhone !== undefined ? (p.contactPhone as string | null) : undefined,
          status: p.status as any,
          color: (p.color as string | undefined) ?? null,
          icon: (p.icon as string | undefined) ?? null,
        },
      });
      return NextResponse.json({ id: updated.id, updatedAt: updated.updatedAt.toISOString() });
    }
    if (body.operation === "DELETE") {
      const existing = await prisma.project.findFirst({
        where: { OR: [{ id: (body.payload as any)?.id }, { clientId: body.entityClientId }], userId: user.id },
      });
      if (existing) await prisma.project.delete({ where: { id: existing.id } });
      return NextResponse.json({ id: existing?.id ?? body.entityClientId, updatedAt: new Date().toISOString() });
    }
  }

  return NextResponse.json({ error: "unsupported" }, { status: 400 });
}

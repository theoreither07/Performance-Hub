import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { checkMcpAuth } from "@/lib/api/mcp-auth";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().nullable().optional(),
  area: z.enum(["PRIVATE", "FH", "BUSINESS"]).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  status: z.enum(["TODO", "IN_PROGRESS", "WAITING", "DONE", "CANCELLED"]).optional(),
  dueDate: z.string().nullable().optional(),
  estimatedMinutes: z.number().int().positive().nullable().optional(),
  projectId: z.string().nullable().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = checkMcpAuth(req);
  if (denied) return denied;
  const { id } = await params;
  const body = patchSchema.parse(await req.json());

  const todo = await prisma.todo.update({
    where: { id },
    data: {
      title: body.title,
      description: body.description === undefined ? undefined : body.description,
      area: body.area,
      priority: body.priority,
      status: body.status,
      dueDate: body.dueDate === undefined ? undefined : body.dueDate ? new Date(body.dueDate) : null,
      estimatedMinutes: body.estimatedMinutes === undefined ? undefined : body.estimatedMinutes,
      projectId: body.projectId === undefined ? undefined : body.projectId,
      completedAt: body.status === "DONE" ? new Date() : body.status ? null : undefined,
    },
  });
  return NextResponse.json({ id: todo.id, status: todo.status });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = checkMcpAuth(req);
  if (denied) return denied;
  const { id } = await params;
  await prisma.todo.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

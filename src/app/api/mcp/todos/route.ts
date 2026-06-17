import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { checkMcpAuth } from "@/lib/api/mcp-auth";

export const dynamic = "force-dynamic";

const PRIMARY_EMAIL = process.env.PRIMARY_EMAIL ?? "";

async function getUserId(): Promise<string> {
  const u = await prisma.user.findUnique({ where: { email: PRIMARY_EMAIL } });
  if (!u) throw new Error("Primary user not found");
  return u.id;
}

// GET /api/mcp/todos?status=open|all&area=PRIVATE|FH|BUSINESS&limit=50
export async function GET(req: Request) {
  const denied = checkMcpAuth(req);
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const statusParam = searchParams.get("status") ?? "open";
  const area = searchParams.get("area");
  const limit = Math.min(200, Math.max(1, Number(searchParams.get("limit") ?? "50")));

  const userId = await getUserId();

  const todos = await prisma.todo.findMany({
    where: {
      userId,
      ...(statusParam === "open" ? { status: { in: ["TODO", "IN_PROGRESS", "WAITING"] } } : {}),
      ...(statusParam === "done" ? { status: "DONE" } : {}),
      ...(area ? { area: area as "PRIVATE" | "FH" | "BUSINESS" } : {}),
    },
    include: { project: { select: { id: true, name: true, area: true } } },
    orderBy: [{ dueDate: "asc" }, { priority: "desc" }, { createdAt: "desc" }],
    take: limit,
  });

  return NextResponse.json({
    todos: todos.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      area: t.area,
      status: t.status,
      priority: t.priority,
      dueDate: t.dueDate?.toISOString() ?? null,
      estimatedMinutes: t.estimatedMinutes,
      project: t.project,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    })),
  });
}

const createSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().optional(),
  area: z.enum(["PRIVATE", "FH", "BUSINESS"]),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  status: z.enum(["TODO", "IN_PROGRESS", "WAITING", "DONE", "CANCELLED"]).optional(),
  dueDate: z.string().optional(),
  estimatedMinutes: z.number().int().positive().optional(),
  projectId: z.string().optional(),
});

export async function POST(req: Request) {
  const denied = checkMcpAuth(req);
  if (denied) return denied;
  const body = createSchema.parse(await req.json());
  const userId = await getUserId();

  const todo = await prisma.todo.create({
    data: {
      userId,
      title: body.title,
      description: body.description ?? null,
      area: body.area,
      priority: body.priority ?? "MEDIUM",
      status: body.status ?? "TODO",
      dueDate: body.dueDate ? new Date(body.dueDate) : null,
      estimatedMinutes: body.estimatedMinutes ?? null,
      projectId: body.projectId ?? null,
    },
  });
  return NextResponse.json({ id: todo.id, title: todo.title });
}

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

export async function GET(req: Request) {
  const denied = checkMcpAuth(req);
  if (denied) return denied;
  const userId = await getUserId();
  const projects = await prisma.project.findMany({
    where: { userId },
    include: { _count: { select: { todos: true } } },
    orderBy: [{ status: "asc" }, { area: "asc" }, { name: "asc" }],
  });
  return NextResponse.json({
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      area: p.area,
      status: p.status,
      contactName: p.contactName,
      contactEmail: p.contactEmail,
      contactPhone: p.contactPhone,
      todoCount: p._count.todos,
    })),
  });
}

const createSchema = z.object({
  name: z.string().min(1).max(200),
  area: z.enum(["PRIVATE", "FH", "BUSINESS"]),
  description: z.string().optional(),
  contactName: z.string().optional(),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().optional(),
  color: z.string().optional(),
});

export async function POST(req: Request) {
  const denied = checkMcpAuth(req);
  if (denied) return denied;
  const body = createSchema.parse(await req.json());
  const userId = await getUserId();
  const project = await prisma.project.create({
    data: {
      userId,
      name: body.name,
      area: body.area,
      description: body.description ?? null,
      contactName: body.contactName ?? null,
      contactEmail: body.contactEmail ?? null,
      contactPhone: body.contactPhone ?? null,
      color: body.color ?? null,
    },
  });
  return NextResponse.json({ id: project.id, name: project.name });
}

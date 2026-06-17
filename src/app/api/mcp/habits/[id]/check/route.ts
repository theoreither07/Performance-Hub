import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { checkMcpAuth } from "@/lib/api/mcp-auth";
import { startOfDay } from "date-fns";

export const dynamic = "force-dynamic";

const schema = z.object({
  date: z.string().optional(), // ISO; default today
  done: z.boolean(),
  note: z.string().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = checkMcpAuth(req);
  if (denied) return denied;
  const { id: habitId } = await params;
  const body = schema.parse(await req.json());
  const date = startOfDay(body.date ? new Date(body.date) : new Date());

  if (body.done) {
    await prisma.habitEntry.upsert({
      where: { habitId_date: { habitId, date } },
      update: { note: body.note ?? null },
      create: { habitId, date, note: body.note ?? null },
    });
  } else {
    await prisma.habitEntry.deleteMany({ where: { habitId, date } });
  }
  return NextResponse.json({ ok: true });
}

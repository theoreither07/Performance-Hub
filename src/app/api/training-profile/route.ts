import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getCurrentUser } from "@/lib/api/get-user";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  const profile = await prisma.trainingProfile.findUnique({ where: { userId: user.id } });
  return NextResponse.json({ profile });
}

const slotPrefsSchema = z.object({
  morningStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  morningEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  // noonPreferred bleibt fuer Rueckwaerts-Kompat (Start-Zeit), noonEnd ist neu (Fenster-Ende)
  noonPreferred: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  noonEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  noonFallbacks: z.array(z.string().regex(/^\d{2}:\d{2}$/)).max(4).optional(),
  satLongStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  satLongEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  sundayLightOnly: z.boolean().optional(),
}).nullable();

const upsertSchema = z.object({
  strengthPerWeek: z.number().int().min(0).max(14).optional(),
  runsPerWeek: z.number().int().min(0).max(14).optional(),
  longRunKm: z.number().min(0).max(100).nullable().optional(),
  shortRunKm: z.number().min(0).max(100).nullable().optional(),
  goals: z.string().max(2000).nullable().optional(),
  maxHr: z.number().int().min(100).max(230).nullable().optional(),
  dailyCaloriesGoal: z.number().int().min(0).max(10000).nullable().optional(),
  dailyStepsGoal: z.number().int().min(0).max(100000).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  weeklyPlan: z.unknown().optional(),
  weeklySlotPrefs: slotPrefsSchema.optional(),
  weeklyTemplateMarkdown: z.string().max(16000).nullable().optional(),
});

export async function POST(req: Request) {
  const user = await getCurrentUser();
  const body = upsertSchema.parse(await req.json());
  const profile = await prisma.trainingProfile.upsert({
    where: { userId: user.id },
    update: body as object,
    create: {
      userId: user.id,
      strengthPerWeek: body.strengthPerWeek ?? 0,
      runsPerWeek: body.runsPerWeek ?? 0,
      longRunKm: body.longRunKm ?? null,
      shortRunKm: body.shortRunKm ?? null,
      goals: body.goals ?? null,
      maxHr: body.maxHr ?? null,
      notes: body.notes ?? null,
      weeklyPlan: (body.weeklyPlan ?? null) as never,
      weeklySlotPrefs: (body.weeklySlotPrefs ?? null) as never,
      weeklyTemplateMarkdown: body.weeklyTemplateMarkdown ?? null,
    },
  });
  return NextResponse.json({ profile });
}

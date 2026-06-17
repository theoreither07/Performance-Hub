import { PrismaClient, LifeArea, Priority } from "@prisma/client";
import { ADVICE_SEED } from "./advice-seed";

const prisma = new PrismaClient();

async function main() {
  // Single-User-Setup: Adressen kommen aus der .env (siehe .env.example).
  const email = process.env.PRIMARY_EMAIL ?? process.env.GOOGLE_PRIVATE_EMAIL ?? "you@example.com";
  const businessEmail = process.env.GOOGLE_BUSINESS_EMAIL;
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name: process.env.PRIMARY_NAME ?? "Dashboard User" },
  });

  await prisma.googleAccount.upsert({
    where: { email },
    update: { isPrimary: true },
    create: {
      userId: user.id,
      email,
      kind: "PRIVATE",
      isPrimary: true,
      refreshToken: "", // wird beim ersten OAuth gesetzt
      scopes: [],
    },
  });

  if (businessEmail) {
    await prisma.googleAccount.upsert({
      where: { email: businessEmail },
      update: {},
      create: {
        userId: user.id,
        email: businessEmail,
        kind: "BUSINESS",
        isPrimary: false,
        refreshToken: "",
        scopes: [],
      },
    });
  }

  const demoProject = await prisma.project.upsert({
    where: { id: "seed-project-dashboard" },
    update: {},
    create: {
      id: "seed-project-dashboard",
      userId: user.id,
      area: LifeArea.BUSINESS,
      name: "Personal Dashboard Launch",
      description: "Phase 1 MVP fertigstellen und auf VPS deployen.",
      color: "#AAFF00",
      icon: "layout-dashboard",
    },
  });

  await prisma.todo.createMany({
    skipDuplicates: true,
    data: [
      {
        id: "seed-todo-1",
        userId: user.id,
        area: LifeArea.BUSINESS,
        title: "VPS einrichten und Docker installieren",
        priority: Priority.HIGH,
        projectId: demoProject.id,
      },
      {
        id: "seed-todo-2",
        userId: user.id,
        area: LifeArea.PRIVATE,
        title: "Workout-Plan fuer die Woche planen",
        priority: Priority.MEDIUM,
      },
      {
        id: "seed-todo-3",
        userId: user.id,
        area: LifeArea.FH,
        title: "Abgabe vorbereiten",
        priority: Priority.URGENT,
      },
    ],
  });

  // Advice (Kevin Kelly Aphorismen) — nur seeden, wenn DB leer ist
  const existingAdvice = await prisma.advice.count();
  if (existingAdvice === 0) {
    await prisma.advice.createMany({
      data: ADVICE_SEED,
      skipDuplicates: true,
    });
    console.log(`${ADVICE_SEED.length} Advice-Eintraege geseedet.`);
  } else {
    console.log(`Advice bereits ${existingAdvice} Eintraege — uebersprungen.`);
  }

  console.log("Seed fertig fuer", user.email);
}

main().finally(() => prisma.$disconnect());

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getCurrentUser } from "@/lib/api/get-user";

// Default-Slots aus Env: privates Google-Konto (Source of Truth fuer Kalender) +
// optional ein Business-Konto parallel. Werden lazy angelegt damit der User
// auf der Settings/Kalender-Seite direkt die Buttons sieht.
const DEFAULT_ACCOUNTS = [
  process.env.GOOGLE_PRIVATE_EMAIL
    ? { email: process.env.GOOGLE_PRIVATE_EMAIL, kind: "PRIVATE" as const, isPrimary: true }
    : null,
  process.env.GOOGLE_BUSINESS_EMAIL
    ? { email: process.env.GOOGLE_BUSINESS_EMAIL, kind: "BUSINESS" as const, isPrimary: false }
    : null,
].filter((a): a is { email: string; kind: "PRIVATE" | "BUSINESS"; isPrimary: boolean } => a !== null);

export async function GET() {
  const user = await getCurrentUser();

  for (const acc of DEFAULT_ACCOUNTS) {
    const existing = await prisma.googleAccount.findUnique({ where: { email: acc.email } });
    if (!existing) {
      await prisma.googleAccount.create({
        data: {
          userId: user.id,
          email: acc.email,
          kind: acc.kind,
          isPrimary: acc.isPrimary,
          refreshToken: "",
          scopes: [],
        },
      });
    } else if (existing.userId !== user.id) {
      // Re-link an aktuellen User (Migration von Seed-User)
      await prisma.googleAccount.update({
        where: { email: acc.email },
        data: { userId: user.id },
      });
    }
  }

  const accounts = await prisma.googleAccount.findMany({
    where: { userId: user.id },
    orderBy: { kind: "asc" },
  });

  return NextResponse.json({
    oauthConfigured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    accounts: accounts.map((a) => ({
      email: a.email,
      kind: a.kind,
      isPrimary: a.isPrimary,
      connected: Boolean(a.refreshToken),
    })),
  });
}

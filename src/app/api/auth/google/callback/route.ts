import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getCurrentUser } from "@/lib/api/get-user";
import { syncCalendarsForAccount } from "@/lib/api/google-calendar";
import { exchangeCodeForTokens, gmailUserProfile } from "@/lib/api/google-fetch";

function baseUrl(req: Request): string {
  return process.env.NEXTAUTH_URL ?? req.url;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const kind = searchParams.get("state") === "BUSINESS" ? "BUSINESS" : "PRIVATE";
  const base = baseUrl(req);
  if (!code) {
    return NextResponse.redirect(new URL("/settings?error=missing_code", base));
  }

  const redirectUri = `${process.env.NEXTAUTH_URL ?? "http://localhost:3001"}/api/auth/google/callback`;
  const tokens = await exchangeCodeForTokens({ code, redirectUri });
  if (!tokens.refresh_token) {
    return NextResponse.redirect(new URL("/settings?error=no_refresh_token", base));
  }

  // Email holen — wir nutzen Gmail-Profile (statt OAuth2 userinfo) weil gmail.readonly Scope sowieso da ist
  const profile = await gmailUserProfile(tokens.access_token).catch(() => null);
  const email = profile?.emailAddress;
  if (!email) {
    return NextResponse.redirect(new URL("/settings?error=no_email", base));
  }

  const user = await getCurrentUser();
  const isPrimary = kind === "PRIVATE";

  const acc = await prisma.googleAccount.upsert({
    where: { email },
    update: {
      userId: user.id,
      kind,
      refreshToken: tokens.refresh_token,
      isPrimary,
      scopes: tokens.scope?.split(" ") ?? [],
    },
    create: {
      userId: user.id,
      kind,
      email,
      refreshToken: tokens.refresh_token,
      isPrimary,
      scopes: tokens.scope?.split(" ") ?? [],
    },
  });

  try {
    await syncCalendarsForAccount(acc.id);
  } catch (err) {
    console.error("[oauth] calendar sync after connect failed", err);
  }

  return NextResponse.redirect(new URL("/settings?connected=" + encodeURIComponent(email), base));
}

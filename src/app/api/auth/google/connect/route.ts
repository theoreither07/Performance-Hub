import { NextResponse } from "next/server";
import { buildOAuthAuthUrl } from "@/lib/api/google-fetch";

const SCOPES = [
  // calendar.events deckt Read + Write von Events ab (Phase 4 Schreiben).
  "https://www.googleapis.com/auth/calendar.events",
  // calendar.readonly zusaetzlich, damit calendarList.list (Listing der verfuegbaren Kalender)
  // funktioniert — calendar.events allein erlaubt keinen CalendarList-Read (=> 403 nach reconnect).
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
];

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const kind = searchParams.get("kind") === "BUSINESS" ? "BUSINESS" : "PRIVATE";

  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return NextResponse.redirect(
      new URL("/settings?error=oauth_not_configured", process.env.NEXTAUTH_URL ?? req.url),
    );
  }

  const redirectUri = `${process.env.NEXTAUTH_URL ?? "http://localhost:3001"}/api/auth/google/callback`;
  const url = buildOAuthAuthUrl({
    scope: SCOPES,
    state: kind,
    loginHint: kind === "BUSINESS" ? process.env.GOOGLE_BUSINESS_EMAIL : process.env.GOOGLE_PRIVATE_EMAIL,
    redirectUri,
    accessType: "offline",
    prompt: "consent",
  });

  return NextResponse.redirect(url);
}

import { NextResponse } from "next/server";
import { auth } from "@/auth";

// Schuetzt alle Routes ausser:
// - /signin (Login-Seite)
// - /api/auth/* (NextAuth + bestehende Google-OAuth fuer Calendar)
// - /_next/*, /icons/*, /manifest.webmanifest, /sw.js, /favicon (Assets/PWA)
// - /api/health (Healthcheck unauth, fuer Docker)
const PUBLIC_PATHS = [
  "/signin",
  "/api/auth",
  "/api/health",
  "/api/mcp", // MCP-Endpoints haben eigene Bearer-Token-Auth (mcp-auth.ts)
  "/api/coach/auto-generate", // Cron-Endpoint mit eigenem Token-Check
  "/api/coach/weekly-plan/auto-generate", // Weekly-Plan Cron mit eigenem Token-Check
  "/api/coach/week-plan/clear", // Clear-Endpoint mit Cron-Token + User-Session Dual-Auth
  "/_next",
  "/icons",
  "/manifest.webmanifest",
  "/sw.js",
  "/favicon.ico",
];

export default auth((req) => {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  if (!req.auth) {
    const url = req.nextUrl.clone();
    url.pathname = "/signin";
    url.searchParams.set("from", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
});

export const config = {
  // Match auf alles ausser statische Assets
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

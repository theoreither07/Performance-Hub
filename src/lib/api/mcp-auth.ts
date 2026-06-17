/**
 * Auth-Helper fuer MCP-Endpoints.
 * Akzeptiert `Authorization: Bearer <token>` mit Wert aus env MCP_API_TOKEN.
 * Wirft 401 wenn nicht authorisiert.
 */
import { NextResponse } from "next/server";

export function checkMcpAuth(req: Request): NextResponse | null {
  const expected = process.env.MCP_API_TOKEN;
  if (!expected || expected.length < 16) {
    return NextResponse.json(
      { error: "MCP_API_TOKEN not configured on server" },
      { status: 503 },
    );
  }
  const header = req.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!provided || !timingSafeEqual(provided, expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

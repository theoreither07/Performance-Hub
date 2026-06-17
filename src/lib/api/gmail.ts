/**
 * Gmail-Adapter — schlank via direct fetch (ohne `googleapis`).
 */
import { prisma } from "@/lib/db/prisma";
import {
  getAccessToken,
  gmailMessagesList,
  gmailMessageGet,
  gmailLabelGet,
} from "@/lib/api/google-fetch";

export interface MailMessage {
  id: string;
  threadId: string;
  accountEmail: string;
  accountKind: "PRIVATE" | "BUSINESS";
  from: string;
  fromEmail: string;
  subject: string;
  snippet: string;
  date: string;
  unread: boolean;
  starred: boolean;
  important: boolean;
  webUrl: string;
}

function parseFrom(header: string | undefined): { name: string; email: string } {
  if (!header) return { name: "", email: "" };
  const m = header.match(/^(.*?)\s*<([^>]+)>$/);
  if (m) return { name: m[1].replace(/^"|"$/g, "").trim(), email: m[2].trim() };
  return { name: header.trim(), email: header.trim() };
}

function getHeader(headers: Array<{ name: string; value: string }> | undefined, name: string): string {
  if (!headers) return "";
  const h = headers.find((x) => x.name?.toLowerCase() === name.toLowerCase());
  return h?.value ?? "";
}

export async function fetchMessages(opts: {
  accountKind?: "PRIVATE" | "BUSINESS";
  query?: string;
  maxResults?: number;
}): Promise<MailMessage[]> {
  const where = opts.accountKind ? { kind: opts.accountKind } : {};
  const accounts = await prisma.googleAccount.findMany({
    where: { ...where, refreshToken: { not: "" } },
  });
  if (accounts.length === 0) return [];

  const query = opts.query ?? "is:unread";
  const max = Math.min(50, opts.maxResults ?? 25);
  const all: MailMessage[] = [];

  for (const acc of accounts) {
    try {
      const accessToken = await getAccessToken(acc.refreshToken);
      const list = await gmailMessagesList(accessToken, { q: query, maxResults: max });
      const ids = (list.messages ?? []).map((m) => m.id).filter(Boolean);
      if (ids.length === 0) continue;

      const batches = await Promise.all(
        ids.map((id) => gmailMessageGet(accessToken, id, "metadata")),
      );

      for (const msg of batches) {
        if (!msg.id) continue;
        const headers = msg.payload?.headers ?? [];
        const fromHeader = getHeader(headers, "From");
        const { name, email } = parseFrom(fromHeader);
        const labels = msg.labelIds ?? [];
        const internalDate = msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : new Date().toISOString();
        all.push({
          id: msg.id,
          threadId: msg.threadId ?? msg.id,
          accountEmail: acc.email,
          accountKind: acc.kind,
          from: name || email,
          fromEmail: email,
          subject: getHeader(headers, "Subject") || "(Kein Betreff)",
          snippet: msg.snippet ?? "",
          date: internalDate,
          unread: labels.includes("UNREAD"),
          starred: labels.includes("STARRED"),
          important: labels.includes("IMPORTANT"),
          webUrl: `https://mail.google.com/mail/?authuser=${encodeURIComponent(acc.email)}#inbox/${msg.threadId}`,
        });
      }
    } catch (err) {
      console.error(`[gmail] account ${acc.email} failed`, err);
    }
  }

  all.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return all;
}

export async function getUnreadCounts(): Promise<{ accountEmail: string; accountKind: "PRIVATE" | "BUSINESS"; count: number }[]> {
  const accounts = await prisma.googleAccount.findMany({
    where: { refreshToken: { not: "" } },
  });

  const result: { accountEmail: string; accountKind: "PRIVATE" | "BUSINESS"; count: number }[] = [];
  for (const acc of accounts) {
    try {
      const accessToken = await getAccessToken(acc.refreshToken);
      const label = await gmailLabelGet(accessToken, "INBOX");
      result.push({ accountEmail: acc.email, accountKind: acc.kind, count: label.messagesUnread ?? 0 });
    } catch (err) {
      console.error(`[gmail] unread-count for ${acc.email} failed`, err);
      result.push({ accountEmail: acc.email, accountKind: acc.kind, count: -1 });
    }
  }
  return result;
}

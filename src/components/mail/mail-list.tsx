"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Star, AlertCircle, ExternalLink, Inbox } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { de } from "@/lib/i18n/date-locale";
import { cn } from "@/lib/utils/cn";

interface MailMessage {
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

export function MailList({ account, query }: { account?: "PRIVATE" | "BUSINESS"; query?: string }) {
  const params = new URLSearchParams();
  if (account) params.set("account", account);
  if (query) params.set("query", query);

  const { data, isLoading, error } = useQuery<{ messages: MailMessage[] }>({
    queryKey: ["mail-list", account, query],
    queryFn: async () => {
      const res = await fetch(`/api/mail/list?${params}`);
      if (!res.ok) throw new Error("mail");
      return res.json();
    },
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  if (isLoading) return <p className="text-sm text-muted-foreground py-4">Laden...</p>;

  if (error) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          Mails konnten nicht geladen werden. Hast du den <b>Gmail-Scope</b> verbunden? Geh auf{" "}
          <a href="/settings" className="text-primary underline">Einstellungen</a> und klick bei
          beiden Google-Konten auf &laquo;Neu verbinden&raquo; — diesmal wird auch Gmail-Lesezugriff
          angefragt.
        </CardContent>
      </Card>
    );
  }

  if (!data || data.messages.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center">
          <Inbox className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">Inbox Zero</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-1.5">
      {data.messages.map((m) => (
        <a
          key={m.id}
          href={m.webUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "block p-3 rounded-lg border border-border/40 transition-colors",
            "hover:bg-accent/40 hover:border-primary/40",
            m.unread && "bg-card border-border",
            !m.unread && "opacity-70",
          )}
        >
          <div className="flex items-start gap-3">
            <div className="flex flex-col gap-1 items-center pt-0.5">
              {m.starred && <Star className="h-3 w-3 fill-amber-400 text-amber-400" />}
              {m.important && <AlertCircle className="h-3 w-3 text-destructive" />}
              {!m.starred && !m.important && m.unread && (
                <span className="h-1.5 w-1.5 rounded-full bg-primary mt-1" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className={cn("text-sm truncate", m.unread ? "font-semibold" : "font-normal")}>
                  {m.from}
                </p>
                <Badge variant={m.accountKind === "PRIVATE" ? "priv" : "biz"} className="text-[10px]">
                  {m.accountKind === "PRIVATE" ? "Privat" : "Biz"}
                </Badge>
                <span className="text-xs text-muted-foreground ml-auto shrink-0">
                  {formatDistanceToNow(new Date(m.date), { locale: de, addSuffix: false })}
                </span>
              </div>
              <p className={cn("text-sm mt-0.5 truncate", m.unread ? "text-foreground" : "text-muted-foreground")}>
                {m.subject}
              </p>
              {m.snippet && (
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{m.snippet}</p>
              )}
            </div>
            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0 mt-1" />
          </div>
        </a>
      ))}
    </div>
  );
}

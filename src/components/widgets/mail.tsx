"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { Mail } from "lucide-react";
import Link from "next/link";

interface CountsResponse {
  counts: { accountEmail: string; accountKind: "PRIVATE" | "BUSINESS"; count: number }[];
}

export function MailWidget() {
  const { data, isLoading } = useQuery<CountsResponse>({
    queryKey: ["mail-counts"],
    queryFn: async () => {
      const res = await fetch("/api/mail/unread-count");
      if (!res.ok) throw new Error("counts");
      return res.json();
    },
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  if (isLoading || !data || data.counts.length === 0) return null;

  const valid = data.counts.filter((c) => c.count >= 0);
  if (valid.length === 0) return null;

  const total = valid.reduce((s, c) => s + c.count, 0);
  const priv = valid.find((c) => c.accountKind === "PRIVATE");
  const biz = valid.find((c) => c.accountKind === "BUSINESS");

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Mail className="h-4 w-4" /> Inbox
          <span className="text-xs text-muted-foreground font-normal ml-auto">
            {total} ungelesen
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid grid-cols-2 gap-3">
          {priv && (
            <Link
              href="/mail"
              className="block p-3 rounded-lg bg-priv/10 border border-priv/20 hover:border-priv/40 transition-colors"
            >
              <p className="text-xs text-muted-foreground">Privat</p>
              <p className="text-2xl font-bold text-priv mt-0.5">{priv.count}</p>
            </Link>
          )}
          {biz && (
            <Link
              href="/mail"
              className="block p-3 rounded-lg bg-brand-lime/10 border border-brand-lime/20 hover:border-brand-lime/40 transition-colors"
            >
              <p className="text-xs text-muted-foreground">Business</p>
              <p className="text-2xl font-bold text-brand-lime mt-0.5">{biz.count}</p>
            </Link>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

"use client";

import * as React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { MailList } from "@/components/mail/mail-list";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Filter } from "lucide-react";

const FILTERS: { value: string; label: string; q: string }[] = [
  { value: "unread", label: "Ungelesen", q: "is:unread in:inbox" },
  { value: "starred", label: "Markiert", q: "is:starred in:inbox" },
  { value: "needs_reply", label: "Needs Reply", q: "is:unread in:inbox -from:me -category:promotions -category:social -category:updates -category:forums" },
  { value: "all", label: "Inbox", q: "in:inbox" },
];

export default function MailPage() {
  const [filter, setFilter] = React.useState("unread");
  const currentQ = FILTERS.find((f) => f.value === filter)?.q ?? FILTERS[0].q;

  const { data: counts } = useQuery<{ counts: { accountKind: string; count: number }[] }>({
    queryKey: ["mail-counts"],
    queryFn: async () => {
      const res = await fetch("/api/mail/unread-count");
      if (!res.ok) throw new Error("counts");
      return res.json();
    },
    staleTime: 60_000,
  });

  const privCount = counts?.counts.find((c) => c.accountKind === "PRIVATE")?.count;
  const bizCount = counts?.counts.find((c) => c.accountKind === "BUSINESS")?.count;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Mail</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Aggregierte Inbox aus deinem privaten und (optional) Business-Google-Konto.
        </p>
      </div>

      <Card>
        <CardContent className="py-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Filter className="h-4 w-4 text-muted-foreground" />
            {FILTERS.map((f) => (
              <Button
                key={f.value}
                size="sm"
                variant={filter === f.value ? "default" : "outline"}
                onClick={() => setFilter(f.value)}
                className="h-7 text-xs"
              >
                {f.label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="ALL">
        <TabsList>
          <TabsTrigger value="ALL">Alle</TabsTrigger>
          <TabsTrigger value="PRIVATE">
            Privat{privCount !== undefined && privCount >= 0 && ` (${privCount})`}
          </TabsTrigger>
          <TabsTrigger value="BUSINESS">
            Business{bizCount !== undefined && bizCount >= 0 && ` (${bizCount})`}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="ALL">
          <MailList query={currentQ} />
        </TabsContent>
        <TabsContent value="PRIVATE">
          <MailList account="PRIVATE" query={currentQ} />
        </TabsContent>
        <TabsContent value="BUSINESS">
          <MailList account="BUSINESS" query={currentQ} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

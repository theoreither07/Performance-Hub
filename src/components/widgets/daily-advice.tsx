"use client";

import { Card, CardContent } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Sparkles } from "lucide-react";

interface AdviceResponse {
  advice: {
    id: number;
    text: string;
    category: string | null;
    source: string;
  } | null;
}

export function DailyAdviceWidget() {
  const { data, isLoading } = useQuery<AdviceResponse>({
    queryKey: ["advice-today"],
    queryFn: async () => {
      const res = await fetch("/api/advice/today");
      if (!res.ok) throw new Error("advice");
      return res.json();
    },
    staleTime: 60 * 60_000, // 1h — wechselt eh nur taeglich
  });

  if (isLoading || !data?.advice) return null;

  return (
    <Card className="bg-gradient-to-br from-primary/10 via-card to-card border-primary/20">
      <CardContent className="py-5">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <p className="text-[10px] uppercase tracking-wider text-primary font-medium">
                Tagesweisheit
              </p>
              {data.advice.category && (
                <span className="text-[10px] text-muted-foreground">
                  &middot; {data.advice.category}
                </span>
              )}
            </div>
            <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">
              {data.advice.text}
            </p>
            <p className="flex items-center gap-1 text-[11px] text-muted-foreground mt-3">
              <BookOpen className="h-3 w-3" />
              {data.advice.source}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

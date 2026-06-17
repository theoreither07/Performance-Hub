"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TodoCheckbox } from "@/components/ui/todo-checkbox";
import Link from "next/link";
import { Flame, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { HabitData } from "@/components/habits/habit-card";

export function HabitsWidget() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<{ habits: HabitData[] }>({
    queryKey: ["habits"],
    queryFn: async () => {
      const res = await fetch("/api/habits");
      if (!res.ok) throw new Error("habits");
      return res.json();
    },
    staleTime: 30_000,
  });

  const toggle = useMutation({
    mutationFn: async ({ id, done }: { id: string; done: boolean }) => {
      const res = await fetch(`/api/habits/${id}/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ done }),
      });
      if (!res.ok) throw new Error("toggle");
    },
    onMutate: async ({ id, done }) => {
      await qc.cancelQueries({ queryKey: ["habits"] });
      qc.setQueryData<{ habits: HabitData[] }>(["habits"], (old) => {
        if (!old) return old;
        return {
          habits: old.habits.map((h) => (h.id === id ? { ...h, doneToday: done } : h)),
        };
      });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["habits"] }),
  });

  if (isLoading) return null;
  const habits = data?.habits ?? [];
  if (habits.length === 0) return null;

  const done = habits.filter((h) => h.doneToday).length;
  const allDone = done === habits.length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <span>Habits heute</span>
          <span className="text-xs text-muted-foreground font-normal ml-auto">
            {done}/{habits.length} {allDone && "✨"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {habits.map((h) => {
          const color = h.color ?? "#AAFF00";
          return (
            <div key={h.id} className="flex items-center gap-3 py-1.5">
              <TodoCheckbox
                checked={h.doneToday}
                onCheck={(v) => toggle.mutate({ id: h.id, done: v })}
                style={h.doneToday ? { backgroundColor: color, borderColor: color } : undefined}
              />
              <Link href="/habits" className="flex-1 min-w-0 group">
                <p
                  className={cn(
                    "text-sm font-medium truncate group-hover:text-primary transition-colors",
                    h.doneToday && "text-muted-foreground",
                  )}
                >
                  {h.name}
                </p>
              </Link>
              {h.streak > 0 && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Flame className="h-3 w-3 text-orange-400" />
                  {h.streak}
                </span>
              )}
            </div>
          );
        })}
        {allDone && (
          <div className="flex items-center justify-center gap-1.5 pt-2 text-xs text-primary">
            <CheckCircle2 className="h-3.5 w-3.5" /> Alle Habits heute durch
          </div>
        )}
      </CardContent>
    </Card>
  );
}

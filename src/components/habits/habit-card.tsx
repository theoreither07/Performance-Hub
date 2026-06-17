"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { TodoCheckbox } from "@/components/ui/todo-checkbox";
import { Button } from "@/components/ui/button";
import { Flame, Trash2, MoreVertical } from "lucide-react";
import { celebrateBig } from "@/lib/utils/celebrate";
import { cn } from "@/lib/utils/cn";

export interface HabitData {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  targetPerWeek: number;
  doneToday: boolean;
  streak: number;
  last30: { date: string; done: boolean }[];
  completionRate30: number;
}

export function HabitCard({ habit }: { habit: HabitData }) {
  const qc = useQueryClient();
  const [menuOpen, setMenuOpen] = React.useState(false);

  const toggle = useMutation({
    mutationFn: async (done: boolean) => {
      const res = await fetch(`/api/habits/${habit.id}/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ done }),
      });
      if (!res.ok) throw new Error("toggle");
    },
    onMutate: async (done) => {
      await qc.cancelQueries({ queryKey: ["habits"] });
      qc.setQueryData<{ habits: HabitData[] }>(["habits"], (old) => {
        if (!old) return old;
        return {
          habits: old.habits.map((h) =>
            h.id === habit.id
              ? {
                  ...h,
                  doneToday: done,
                  streak: done ? h.streak + (h.doneToday ? 0 : 1) : Math.max(0, h.streak - 1),
                  last30: h.last30.map((d) =>
                    d.date === new Date().toISOString().slice(0, 10) ? { ...d, done } : d,
                  ),
                }
              : h,
          ),
        };
      });
      if (done && habit.streak >= 6 && (habit.streak + 1) % 7 === 0) {
        celebrateBig();
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["habits"] }),
  });

  const remove = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/habits/${habit.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["habits"] }),
  });

  const color = habit.color ?? "#AAFF00";
  const pct = Math.round(habit.completionRate30 * 100);

  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-start gap-3">
          <div className="pt-0.5">
            <TodoCheckbox
              checked={habit.doneToday}
              onCheck={(v) => toggle.mutate(v)}
              style={habit.doneToday ? { backgroundColor: color, borderColor: color } : undefined}
            />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <p
                className={cn(
                  "font-medium",
                  habit.doneToday && "text-muted-foreground",
                )}
              >
                {habit.name}
              </p>
              <div className="flex items-center gap-2">
                {habit.streak > 0 && (
                  <div className="flex items-center gap-1 text-xs">
                    <Flame className="h-3.5 w-3.5 text-orange-400" />
                    <span className="font-medium">{habit.streak}</span>
                  </div>
                )}
                <div className="relative">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => setMenuOpen((v) => !v)}
                  >
                    <MoreVertical className="h-3.5 w-3.5" />
                  </Button>
                  {menuOpen && (
                    <>
                      <button
                        className="fixed inset-0 z-30"
                        onClick={() => setMenuOpen(false)}
                        aria-label="close"
                      />
                      <div className="absolute right-0 top-7 z-40 bg-card border border-border rounded-md shadow-lg py-1 min-w-[140px]">
                        <button
                          type="button"
                          className="flex items-center gap-2 px-3 py-1.5 text-sm w-full text-left hover:bg-accent text-destructive"
                          onClick={() => {
                            setMenuOpen(false);
                            if (confirm(`"${habit.name}" wirklich loeschen?`)) remove.mutate();
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Loeschen
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
            {habit.description && (
              <p className="text-xs text-muted-foreground mt-0.5">{habit.description}</p>
            )}

            {/* 30-Tage-Heatmap */}
            <div className="mt-3 flex gap-0.5">
              {habit.last30.map((d) => (
                <div
                  key={d.date}
                  className="h-4 flex-1 rounded-sm transition-colors"
                  style={{
                    backgroundColor: d.done ? color : undefined,
                  }}
                  title={`${d.date}: ${d.done ? "erledigt" : "offen"}`}
                />
              ))}
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
              <span>vor 30 Tagen</span>
              <span>{pct}% in 30 Tagen</span>
              <span>heute</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

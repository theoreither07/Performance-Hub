"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Sparkles } from "lucide-react";
import { HabitCard, type HabitData } from "@/components/habits/habit-card";
import { NewHabitDialog } from "@/components/habits/new-habit-dialog";

export default function HabitsPage() {
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const { data, isLoading } = useQuery<{ habits: HabitData[] }>({
    queryKey: ["habits"],
    queryFn: async () => {
      const res = await fetch("/api/habits");
      if (!res.ok) throw new Error("habits");
      return res.json();
    },
    staleTime: 30_000,
  });

  const habits = data?.habits ?? [];
  const doneCount = habits.filter((h) => h.doneToday).length;
  const total = habits.length;
  const allDone = total > 0 && doneCount === total;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Habits</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {total > 0
              ? `${doneCount} von ${total} heute erledigt${allDone ? " ✨" : ""}`
              : "Bau dir deine Routinen auf."}
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-1" /> Neuer Habit
        </Button>
      </div>

      <NewHabitDialog open={dialogOpen} onOpenChange={setDialogOpen} />

      {isLoading && <p className="text-sm text-muted-foreground">Laden...</p>}

      {!isLoading && habits.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center space-y-3">
            <Sparkles className="h-8 w-8 mx-auto text-primary" />
            <p className="text-sm font-medium">Noch keine Habits</p>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              Tipp: starte mit 2-3 simplen Routinen (z.B. Meditation 10 Min,
              30 Min Lesen, Wasser trinken) und ergaenze spaeter weitere.
            </p>
            <Button onClick={() => setDialogOpen(true)} variant="outline" size="sm">
              <Plus className="h-3.5 w-3.5 mr-1" /> Ersten Habit anlegen
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {habits.map((h) => (
          <HabitCard key={h.id} habit={h} />
        ))}
      </div>
    </div>
  );
}

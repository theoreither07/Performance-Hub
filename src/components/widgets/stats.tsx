"use client";

import { Card, CardContent } from "@/components/ui/card";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db/dexie";
import { CheckSquare, Flag, FolderKanban, Sparkles } from "lucide-react";
import { startOfDay, endOfDay } from "date-fns";
import Link from "next/link";

export function StatsWidget() {
  const stats = useLiveQuery(async () => {
    const todos = await db.todos.toArray();
    const open = todos.filter((t) => !t._deleted && t.status !== "DONE" && t.status !== "CANCELLED");
    const todayStart = startOfDay(new Date());
    const todayEnd = endOfDay(new Date());
    const today = open.filter((t) => t.dueDate && new Date(t.dueDate) >= todayStart && new Date(t.dueDate) <= todayEnd);
    const overdue = open.filter((t) => t.dueDate && new Date(t.dueDate) < todayStart);
    const projects = await db.projects.toArray();
    return {
      open: open.length,
      today: today.length,
      overdue: overdue.length,
      projects: projects.filter((p) => !p._deleted && p.status === "IN_PROGRESS").length,
    };
  });

  const items = [
    { label: "Offene ToDos", value: stats?.open ?? 0, icon: CheckSquare, accent: "text-foreground", href: "/todos?status=open" },
    { label: "Heute faellig", value: stats?.today ?? 0, icon: Sparkles, accent: "text-primary", href: "/todos?filter=today" },
    { label: "Ueberfaellig", value: stats?.overdue ?? 0, icon: Flag, accent: "text-destructive", href: "/todos?filter=overdue" },
    { label: "Aktive Projekte", value: stats?.projects ?? 0, icon: FolderKanban, accent: "text-fh", href: "/projects" },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {items.map((it) => (
        <Link key={it.label} href={it.href} className="group">
          <Card className="group-hover:border-primary/40 group-hover:bg-muted/20 transition-all cursor-pointer">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">{it.label}</p>
                <it.icon className={`h-4 w-4 ${it.accent}`} />
              </div>
              <p className={`mt-2 text-3xl font-bold ${it.accent}`}>{it.value}</p>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}

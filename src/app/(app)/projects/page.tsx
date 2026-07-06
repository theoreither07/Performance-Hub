"use client";

import * as React from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db/dexie";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FolderKanban, Plus, User } from "lucide-react";
import { ProjectDialog } from "@/components/projects/project-dialog";
import { AREA_BADGE_VARIANT } from "@/lib/utils/area-badge";
import { PageHeader } from "@/components/layout/page-header";

export default function ProjectsPage() {
  const [dialogOpen, setDialogOpen] = React.useState(false);

  const projects = useLiveQuery(async () => {
    const all = await db.projects.toArray();
    return all.filter((p) => !p._deleted).sort((a, b) => a.area.localeCompare(b.area));
  });

  const todosByProject = useLiveQuery(async () => {
    const todos = await db.todos.toArray();
    const map: Record<string, { open: number; done: number }> = {};
    for (const t of todos) {
      if (!t.projectId || t._deleted) continue;
      map[t.projectId] = map[t.projectId] ?? { open: 0, done: 0 };
      if (t.status === "DONE") map[t.projectId].done++;
      else map[t.projectId].open++;
    }
    return map;
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Projekte"
        subtitle="Klassifiziert nach Privat, FH und Business."
        actions={
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Neues Projekt
          </Button>
        }
      />

      <ProjectDialog open={dialogOpen} onOpenChange={setDialogOpen} />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {projects?.length === 0 && (
          <p className="text-sm text-muted-foreground col-span-full text-center py-8">
            Noch keine Projekte. Lege oben das erste an.
          </p>
        )}
        {projects?.map((p) => {
          const stats = todosByProject?.[p.id] ?? { open: 0, done: 0 };
          const total = stats.open + stats.done;
          const pct = total ? Math.round((stats.done / total) * 100) : 0;
          return (
            <Link key={p.id} href={`/projects/${p.id}`}>
              <Card className="hover:border-primary/40 transition-colors h-full">
                <CardContent className="pt-5">
                  <div className="flex items-start justify-between">
                    <div
                      className="h-10 w-10 rounded-lg flex items-center justify-center"
                      style={{ backgroundColor: (p.color ?? "#aaff00") + "20" }}
                    >
                      <FolderKanban className="h-5 w-5" style={{ color: p.color ?? "#aaff00" }} />
                    </div>
                    <Badge variant={AREA_BADGE_VARIANT[p.area]}>{p.area.toLowerCase()}</Badge>
                  </div>
                  <h3 className="font-semibold mt-3">{p.name}</h3>
                  {p.description && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{p.description}</p>
                  )}
                  {p.contactName && (
                    <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                      <User className="h-3 w-3" />
                      {p.contactName}
                    </p>
                  )}
                  <div className="mt-4">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{stats.done} von {total} erledigt</span>
                      <span>{pct}%</span>
                    </div>
                    <div className="mt-1 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

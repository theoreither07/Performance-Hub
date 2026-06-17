"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db/dexie";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, User, Mail, Phone, Pencil, FileText } from "lucide-react";
import { createTodoLocal } from "@/lib/sync/local-mutations";
import { TodoRow } from "@/components/todos/todo-row";
import { ProjectDialog } from "@/components/projects/project-dialog";

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const [title, setTitle] = React.useState("");
  const [editOpen, setEditOpen] = React.useState(false);

  const project = useLiveQuery(() => db.projects.get(projectId), [projectId]);
  const todos = useLiveQuery(
    async () => {
      const all = await db.todos.toArray();
      return all
        .filter((t) => !t._deleted && t.projectId === projectId)
        .sort((a, b) => {
          if (a.status === "DONE" && b.status !== "DONE") return 1;
          if (b.status === "DONE" && a.status !== "DONE") return -1;
          return 0;
        });
    },
    [projectId],
  );

  const onAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !project) return;
    await createTodoLocal({ title: title.trim(), area: project.area, projectId });
    setTitle("");
  };

  if (!project) {
    return (
      <div>
        <Link href="/projects" className="text-sm text-muted-foreground inline-flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" /> Zurueck
        </Link>
        <p className="mt-6 text-muted-foreground">Projekt nicht gefunden oder noch nicht synchronisiert.</p>
      </div>
    );
  }

  const hasContact = project.contactName || project.contactEmail || project.contactPhone;

  return (
    <div className="space-y-6">
      <Link href="/projects" className="text-sm text-muted-foreground inline-flex items-center gap-1">
        <ArrowLeft className="h-4 w-4" /> Alle Projekte
      </Link>

      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">{project.name}</h1>
          <div className="flex items-center gap-2 mt-1">
            <Badge>{project.area}</Badge>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
          <Pencil className="h-4 w-4 mr-1.5" /> Bearbeiten
        </Button>
      </div>

      <ProjectDialog open={editOpen} onOpenChange={setEditOpen} project={project} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {project.description && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <FileText className="h-4 w-4" /> Beschreibung
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm whitespace-pre-wrap">{project.description}</p>
            </CardContent>
          </Card>
        )}
        {hasContact && (
          <Card className={project.description ? "" : "lg:col-span-3"}>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <User className="h-4 w-4" /> Ansprechpartner
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {project.contactName && <p className="font-medium">{project.contactName}</p>}
              {project.contactEmail && (
                <a
                  href={`mailto:${project.contactEmail}`}
                  className="flex items-center gap-2 text-muted-foreground hover:text-primary"
                >
                  <Mail className="h-3.5 w-3.5" />
                  {project.contactEmail}
                </a>
              )}
              {project.contactPhone && (
                <a
                  href={`tel:${project.contactPhone}`}
                  className="flex items-center gap-2 text-muted-foreground hover:text-primary"
                >
                  <Phone className="h-3.5 w-3.5" />
                  {project.contactPhone}
                </a>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Aufgaben</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onAdd} className="flex gap-2 mb-3">
            <Input
              placeholder="Neue Aufgabe in diesem Projekt..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <Button type="submit" disabled={!title.trim()}>Hinzufuegen</Button>
          </form>
          {todos?.length === 0 && <p className="text-sm text-muted-foreground py-4 text-center">Noch keine Aufgaben.</p>}
          {todos?.map((t) => <TodoRow key={t.id} todo={t} showArea={false} />)}
        </CardContent>
      </Card>
    </div>
  );
}

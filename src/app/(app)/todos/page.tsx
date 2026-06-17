"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db/dexie";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, ListFilter, X, List, LayoutGrid } from "lucide-react";
import { createTodoLocal } from "@/lib/sync/local-mutations";
import { LIFE_AREAS, type LifeArea } from "@/types/domain";
import { TodoRow } from "@/components/todos/todo-row";
import { TodoBoard } from "@/components/todos/todo-board";
import { QuickAddDialog } from "@/components/dashboard/quick-add-dialog";
import { cn } from "@/lib/utils/cn";
import { startOfDay, endOfDay } from "date-fns";

type ExtraFilter = "today" | "overdue" | null;
type ViewMode = "list" | "board";

const VIEW_KEY = "todos-view";

function TodoListPanel({ area, extraFilter }: { area: LifeArea | "ALL"; extraFilter: ExtraFilter }) {
  const [quickTitle, setQuickTitle] = React.useState("");
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [showCompleted, setShowCompleted] = React.useState(false);
  const [view, setView] = React.useState<ViewMode>("list");

  // View-Praeferenz aus localStorage laden (nach Mount, um Hydration-Mismatch zu vermeiden).
  React.useEffect(() => {
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(VIEW_KEY) : null;
    if (stored === "board" || stored === "list") setView(stored);
  }, []);
  const changeView = (v: ViewMode) => {
    setView(v);
    try { window.localStorage.setItem(VIEW_KEY, v); } catch { /* ignore */ }
  };

  // Basis-Query: alle nicht-geloeschten Todos des Bereichs + Extra-Filter.
  // DONE wird NICHT hier rausgefiltert — Board braucht die Erledigt-Spalte,
  // Liste filtert DONE erst beim Rendern (showCompleted).
  const allTodos = useLiveQuery(async () => {
    const all = await db.todos.toArray();
    let filtered = all.filter((t) => !t._deleted);
    if (area !== "ALL") filtered = filtered.filter((t) => t.area === area);
    if (extraFilter === "today") {
      const ts = startOfDay(new Date()).getTime();
      const te = endOfDay(new Date()).getTime();
      filtered = filtered.filter((t) => t.dueDate && new Date(t.dueDate).getTime() >= ts && new Date(t.dueDate).getTime() <= te);
    } else if (extraFilter === "overdue") {
      const ts = startOfDay(new Date()).getTime();
      filtered = filtered.filter((t) => t.status !== "DONE" && t.dueDate && new Date(t.dueDate).getTime() < ts);
    }
    return filtered;
  }, [area, extraFilter]);

  // Listen-Ansicht: DONE optional ausblenden + nach Faelligkeit sortieren.
  const listTodos = React.useMemo(() => {
    if (!allTodos) return undefined;
    const filtered = showCompleted ? allTodos : allTodos.filter((t) => t.status !== "DONE");
    return [...filtered].sort((a, b) => {
      if (a.status === "DONE" && b.status !== "DONE") return 1;
      if (b.status === "DONE" && a.status !== "DONE") return -1;
      const da = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
      const dbb = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
      if (da !== dbb) return da - dbb;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [allTodos, showCompleted]);

  const quickCreate = async () => {
    const title = quickTitle.trim();
    if (!title) return;
    await createTodoLocal({ title, area: area === "ALL" ? "PRIVATE" : area });
    setQuickTitle("");
  };

  const onPlusClick = () => {
    // Mit Text → sofort anlegen. Ohne Text → Detail-Dialog oeffnen.
    if (quickTitle.trim()) {
      quickCreate();
    } else {
      setDialogOpen(true);
    }
  };

  return (
    <>
      <Card>
        <CardContent className="space-y-3 pt-5">
          <form onSubmit={(e) => { e.preventDefault(); quickCreate(); }} className="flex gap-2">
            <Input
              placeholder="Schnell hinzufuegen... (Enter = sofort anlegen)"
              value={quickTitle}
              onChange={(e) => setQuickTitle(e.target.value)}
              className="flex-1"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={onPlusClick}
              aria-label={quickTitle.trim() ? "Schnell anlegen" : "Mit Details hinzufuegen"}
              title={quickTitle.trim() ? "Schnell anlegen" : "Mit Details hinzufuegen"}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </form>
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {view === "board"
                ? `${allTodos?.length ?? 0} gesamt`
                : `${listTodos?.length ?? 0} ${showCompleted ? "Eintraege" : "offen"}`}
            </span>
            <div className="flex items-center gap-3">
              {view === "list" && (
                <button
                  type="button"
                  onClick={() => setShowCompleted((v) => !v)}
                  className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                >
                  <ListFilter className="h-3 w-3" />
                  {showCompleted ? "Erledigte ausblenden" : "Erledigte zeigen"}
                </button>
              )}
              {/* List/Board-Umschalter */}
              <div className="inline-flex items-center rounded-lg border border-border/50 bg-muted/30 p-0.5">
                <button
                  type="button"
                  onClick={() => changeView("list")}
                  aria-label="Listen-Ansicht"
                  aria-pressed={view === "list"}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md px-2 py-1 transition-colors",
                    view === "list" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <List className="h-3.5 w-3.5" /> Liste
                </button>
                <button
                  type="button"
                  onClick={() => changeView("board")}
                  aria-label="Board-Ansicht"
                  aria-pressed={view === "board"}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md px-2 py-1 transition-colors",
                    view === "board" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <LayoutGrid className="h-3.5 w-3.5" /> Board
                </button>
              </div>
            </div>
          </div>
          {view === "list" ? (
            <div>
              {listTodos === undefined && <p className="text-sm text-muted-foreground py-4">Laden...</p>}
              {listTodos?.length === 0 && (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  Noch keine Aufgaben. Oben eintippen oder ueber das Plus mit Details anlegen.
                </p>
              )}
              {listTodos?.map((t) => <TodoRow key={t.id} todo={t} showArea={area === "ALL"} />)}
            </div>
          ) : (
            <div>
              {allTodos === undefined ? (
                <p className="text-sm text-muted-foreground py-4">Laden...</p>
              ) : (
                <TodoBoard todos={allTodos} showArea={area === "ALL"} />
              )}
            </div>
          )}
        </CardContent>
      </Card>
      <QuickAddDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        defaultArea={area === "ALL" ? "PRIVATE" : area}
      />
    </>
  );
}

export default function TodosPage() {
  return (
    <React.Suspense fallback={<div className="text-sm text-muted-foreground">Laden...</div>}>
      <TodosPageInner />
    </React.Suspense>
  );
}

function TodosPageInner() {
  const params = useSearchParams();
  const filterParam = params.get("filter");
  const extraFilter: ExtraFilter = filterParam === "today" || filterParam === "overdue" ? filterParam : null;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">ToDos</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {extraFilter === "today"
              ? "Aufgaben mit Faelligkeit heute."
              : extraFilter === "overdue"
                ? "Ueberfaellige Aufgaben."
                : "Alle Aufgaben aus den drei Lebensbereichen."}
          </p>
        </div>
        {extraFilter && (
          <a
            href="/todos"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground border border-border/40 rounded-md px-2.5 py-1"
          >
            <X className="h-3 w-3" /> Filter
          </a>
        )}
      </div>
      <Tabs defaultValue="ALL">
        <TabsList className="w-full sm:w-auto overflow-x-auto">
          <TabsTrigger value="ALL">Alle</TabsTrigger>
          {LIFE_AREAS.map((a) => (
            <TabsTrigger key={a.value} value={a.value}>
              {a.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="ALL">
          <TodoListPanel area="ALL" extraFilter={extraFilter} />
        </TabsContent>
        {LIFE_AREAS.map((a) => (
          <TabsContent key={a.value} value={a.value}>
            <TodoListPanel area={a.value} extraFilter={extraFilter} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

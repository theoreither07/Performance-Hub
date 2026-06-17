"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db/dexie";
import { endOfDay } from "date-fns";
import { TodoRow } from "@/components/todos/todo-row";

export function TodayTodosWidget() {
  const todos = useLiveQuery(async () => {
    const all = await db.todos.toArray();
    const todayEnd = endOfDay(new Date());
    return all
      .filter((t) => !t._deleted && t.status !== "DONE" && t.status !== "CANCELLED")
      .filter((t) => !t.dueDate || new Date(t.dueDate) <= todayEnd)
      .sort((a, b) => {
        const da = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
        const dbb = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
        return da - dbb;
      })
      .slice(0, 10);
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Heute</CardTitle>
        <span className="text-xs text-muted-foreground">{todos?.length ?? 0} offen</span>
      </CardHeader>
      <CardContent>
        {todos === undefined && <p className="text-sm text-muted-foreground">Laden...</p>}
        {todos?.length === 0 && (
          <p className="text-sm text-muted-foreground py-6 text-center">
            Nichts mehr fuer heute. Geh raus, beweg dich.
          </p>
        )}
        {todos?.map((t) => <TodoRow key={t.id} todo={t} />)}
      </CardContent>
    </Card>
  );
}

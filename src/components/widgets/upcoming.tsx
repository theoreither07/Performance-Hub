"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db/dexie";
import { addDays, endOfDay, format, startOfDay } from "date-fns";
import { de } from "@/lib/i18n/date-locale";
import type { LifeArea } from "@/types/domain";

const areaBadge: Record<LifeArea, "priv" | "fh" | "biz"> = {
  PRIVATE: "priv",
  FH: "fh",
  BUSINESS: "biz",
};

export function UpcomingWidget() {
  const todos = useLiveQuery(async () => {
    const all = await db.todos.toArray();
    const tomorrow = startOfDay(addDays(new Date(), 1));
    const horizon = endOfDay(addDays(new Date(), 7));
    return all
      .filter((t) => !t._deleted && t.status !== "DONE" && t.status !== "CANCELLED")
      .filter((t) => t.dueDate && new Date(t.dueDate) >= tomorrow && new Date(t.dueDate) <= horizon)
      .sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime())
      .slice(0, 8);
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Naechste 7 Tage</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {todos === undefined && <p className="text-sm text-muted-foreground">Laden...</p>}
        {todos?.length === 0 && (
          <p className="text-sm text-muted-foreground py-4 text-center">Keine geplanten Aufgaben.</p>
        )}
        {todos?.map((t) => (
          <div key={t.id} className="flex items-center gap-3 py-1.5">
            <div className="w-20 text-xs text-muted-foreground">
              {format(new Date(t.dueDate!), "EEE, d. MMM", { locale: de })}
            </div>
            <div className="flex-1 text-sm truncate">{t.title}</div>
            <Badge variant={areaBadge[t.area]}>{t.area.toLowerCase()}</Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

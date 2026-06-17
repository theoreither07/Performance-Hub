"use client";

import * as React from "react";
import { format, addDays, startOfDay, endOfWeek, addWeeks, addMonths, parse, isValid } from "date-fns";
import { de } from "@/lib/i18n/date-locale";
import { Calendar as CalIcon, X, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils/cn";

/**
 * DueDatePicker — schoenerer Ersatz fuer den nativen datetime-local Input.
 *
 * Features:
 *   - Quick-Buttons: Heute, Morgen, Diese Woche (Sonntag), Naechste Woche, +1 Monat
 *   - Kalender-Grid zum Klicken (zwei Monate sichtbar)
 *   - Uhrzeit OPTIONAL — separater Input + "Uhrzeit hinzufuegen" Toggle
 *   - X-Button um das Datum zu entfernen
 *
 * Eingabe & Ausgabe als ISO-DateTime-Local-String (YYYY-MM-DDTHH:mm) oder leer.
 */
export function DueDatePicker({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  const parsed = value
    ? (parse(value, "yyyy-MM-dd'T'HH:mm", new Date()) || null)
    : null;
  const isValidParsed = parsed && isValid(parsed) ? parsed : null;

  const [open, setOpen] = React.useState(false);
  const [calMonth, setCalMonth] = React.useState<Date>(isValidParsed ?? new Date());
  const [showTime, setShowTime] = React.useState<boolean>(
    !!isValidParsed && (isValidParsed.getHours() !== 0 || isValidParsed.getMinutes() !== 0),
  );
  const [time, setTime] = React.useState<string>(
    isValidParsed ? format(isValidParsed, "HH:mm") : "09:00",
  );

  function setDate(d: Date, withTime: boolean) {
    let final = startOfDay(d);
    if (withTime) {
      const [hh, mm] = time.split(":").map((n) => parseInt(n, 10));
      final = new Date(final.getFullYear(), final.getMonth(), final.getDate(), hh || 0, mm || 0);
    }
    onChange(format(final, "yyyy-MM-dd'T'HH:mm"));
  }

  function applyTime(newTime: string) {
    setTime(newTime);
    if (isValidParsed) {
      const [hh, mm] = newTime.split(":").map((n) => parseInt(n, 10));
      const next = new Date(isValidParsed.getFullYear(), isValidParsed.getMonth(), isValidParsed.getDate(), hh || 0, mm || 0);
      onChange(format(next, "yyyy-MM-dd'T'HH:mm"));
    }
  }

  function clear() {
    onChange("");
    setShowTime(false);
    setOpen(false);
  }

  const display = isValidParsed
    ? showTime
      ? format(isValidParsed, "EEE, d. MMM · HH:mm", { locale: de })
      : format(isValidParsed, "EEE, d. MMM", { locale: de })
    : "Kein Datum";

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => setOpen(!open)}
          className={cn("flex-1 justify-start font-normal", !isValidParsed && "text-muted-foreground")}
        >
          <CalIcon className="h-4 w-4 mr-2" />
          {display}
        </Button>
        {isValidParsed && (
          <Button type="button" variant="ghost" size="icon" onClick={clear} aria-label="Datum entfernen" className="h-9 w-9">
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {open && (
        <div className="rounded-lg border border-border/40 bg-background p-3 space-y-3">
          {/* Quick Buttons */}
          <div className="flex flex-wrap gap-1.5">
            <QuickBtn label="Heute" onClick={() => setDate(new Date(), showTime)} />
            <QuickBtn label="Morgen" onClick={() => setDate(addDays(new Date(), 1), showTime)} />
            <QuickBtn
              label="Diese Woche"
              onClick={() => setDate(endOfWeek(new Date(), { weekStartsOn: 1 }), showTime)}
            />
            <QuickBtn
              label="Naechste Woche"
              onClick={() => setDate(addWeeks(new Date(), 1), showTime)}
            />
            <QuickBtn label="+1 Monat" onClick={() => setDate(addMonths(new Date(), 1), showTime)} />
          </div>

          {/* Mini-Kalender */}
          <MiniCalendar
            month={calMonth}
            onMonthChange={setCalMonth}
            selected={isValidParsed}
            onSelect={(d) => setDate(d, showTime)}
          />

          {/* Optionale Uhrzeit */}
          <div className="pt-1 border-t border-border/30 space-y-2">
            {!showTime ? (
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                onClick={() => {
                  setShowTime(true);
                  if (isValidParsed) {
                    const [hh, mm] = time.split(":").map((n) => parseInt(n, 10));
                    const next = new Date(isValidParsed.getFullYear(), isValidParsed.getMonth(), isValidParsed.getDate(), hh, mm);
                    onChange(format(next, "yyyy-MM-dd'T'HH:mm"));
                  }
                }}
              >
                <Clock className="h-3 w-3" /> Uhrzeit hinzufuegen (optional)
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  type="time"
                  value={time}
                  onChange={(e) => applyTime(e.target.value)}
                  className="h-8 w-28 text-sm"
                />
                <button
                  type="button"
                  className="text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setShowTime(false);
                    if (isValidParsed) {
                      onChange(format(startOfDay(isValidParsed), "yyyy-MM-dd'T'HH:mm"));
                    }
                  }}
                >
                  ohne Uhrzeit
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function QuickBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-xs px-2.5 py-1 rounded-md border border-border/40 hover:bg-muted/50 text-foreground"
    >
      {label}
    </button>
  );
}

function MiniCalendar({
  month,
  onMonthChange,
  selected,
  onSelect,
}: {
  month: Date;
  onMonthChange: (d: Date) => void;
  selected: Date | null;
  onSelect: (d: Date) => void;
}) {
  const today = startOfDay(new Date());
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  // ((Sun=0..Sat=6) + 6) % 7 → Mo-aligned
  const startCol = (first.getDay() + 6) % 7;
  const totalDays = last.getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startCol; i++) cells.push(null);
  for (let d = 1; d <= totalDays; d++) cells.push(new Date(month.getFullYear(), month.getMonth(), d));
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => onMonthChange(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
          className="text-xs text-muted-foreground hover:text-foreground px-2"
        >
          ‹
        </button>
        <p className="text-sm font-medium">{format(month, "MMMM yyyy", { locale: de })}</p>
        <button
          type="button"
          onClick={() => onMonthChange(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
          className="text-xs text-muted-foreground hover:text-foreground px-2"
        >
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] text-muted-foreground">
        {["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((d) => (
          <div key={d} className="py-1">{d}</div>
        ))}
        {cells.map((c, i) => {
          if (!c) return <div key={i} />;
          const isToday = c.getTime() === today.getTime();
          const isSelected = selected && c.getTime() === startOfDay(selected).getTime();
          const isPast = c < today && !isToday;
          return (
            <button
              key={i}
              type="button"
              onClick={() => onSelect(c)}
              className={cn(
                "h-7 rounded text-xs font-medium transition-colors",
                isSelected
                  ? "bg-primary text-primary-foreground"
                  : isToday
                    ? "bg-primary/20 text-foreground ring-1 ring-primary/40"
                    : isPast
                      ? "text-muted-foreground/50 hover:bg-muted/30"
                      : "text-foreground hover:bg-muted/50",
              )}
            >
              {c.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Card mit Header, der zum Ausklappen klickbar ist. Default: kollabiert.
 */
export function CollapsibleCard({
  icon,
  title,
  subtitle,
  defaultOpen = false,
  action,
  children,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  defaultOpen?: boolean;
  action?: React.ReactNode; // optionaler Button rechts (z.B. Refresh)
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <Card className={cn("transition-colors", open && "bg-card")}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-5 py-4 flex items-center justify-between gap-3 text-left hover:bg-muted/20 transition-colors rounded-t-lg"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {icon}
          <div className="min-w-0 flex-1">
            <p className="text-base font-medium truncate">{title}</p>
            {subtitle && <p className="text-xs text-muted-foreground truncate mt-0.5">{subtitle}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
          {action}
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
        </div>
      </button>
      {open && (
        <CardContent className="px-5 pb-5 pt-0">
          {children}
        </CardContent>
      )}
    </Card>
  );
}

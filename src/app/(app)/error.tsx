"use client";

/**
 * Route-Group Error-Boundary fuer alle (app)/-Routen.
 * Crash auf einer Page bringt nicht die ganze App down — nur diese Route.
 */
import * as React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  React.useEffect(() => {
    console.error("[app-error]", error);
  }, [error]);

  return (
    <div className="container max-w-2xl py-12">
      <Card className="border-amber-500/40">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-6 w-6 text-amber-300 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h2 className="font-bold text-base">Ups — diese Seite ist abgestürzt</h2>
              <p className="text-sm text-muted-foreground">
                {error.message || "Unbekannter Fehler. Klick \"Neu laden\" um's nochmal zu probieren."}
              </p>
              {error.digest && (
                <p className="text-[10px] text-muted-foreground/60 font-mono mt-2">Digest: {error.digest}</p>
              )}
            </div>
          </div>
          <div className="flex gap-2 pt-2 border-t border-border/30">
            <Button onClick={reset} size="sm">
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Neu laden
            </Button>
            <Button onClick={() => (window.location.href = "/")} size="sm" variant="outline">
              Zurück zum Dashboard
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

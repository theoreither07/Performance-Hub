"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar as CalendarIcon, CheckCircle2 } from "lucide-react";

interface StatusResponse {
  oauthConfigured: boolean;
  accounts: { email: string; kind: "PRIVATE" | "BUSINESS"; isPrimary: boolean; connected: boolean }[];
}

export function CalendarConnectCTA({ compact = false }: { compact?: boolean }) {
  const { data, isLoading } = useQuery<StatusResponse>({
    queryKey: ["google-accounts"],
    queryFn: async () => {
      const res = await fetch("/api/auth/google/status");
      if (!res.ok) return { oauthConfigured: false, accounts: [] };
      return res.json();
    },
    staleTime: 30_000,
  });

  if (isLoading) return null;
  if (!data) return null;

  const anyConnected = data.accounts.some((a) => a.connected);
  if (anyConnected) return null;

  if (compact) {
    return (
      <div className="text-sm text-muted-foreground py-4 text-center space-y-3">
        <p>Noch kein Google-Konto verbunden.</p>
        <Button asChild size="sm">
          <a href="/api/auth/google/connect?kind=PRIVATE">
            <CalendarIcon className="h-4 w-4 mr-2" />
            Jetzt verbinden
          </a>
        </Button>
      </div>
    );
  }

  return (
    <Card>
      <CardContent className="py-8">
        <div className="text-center max-w-md mx-auto space-y-4">
          <div className="mx-auto h-12 w-12 rounded-full bg-primary/15 flex items-center justify-center">
            <CalendarIcon className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold text-base">Google-Kalender verbinden</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Verbinde deine beiden Google-Konten, damit die Termine hier erscheinen.
              Privat ist Source of Truth — fang dort an.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 justify-center">
            {data.accounts.map((acc) => (
              <Button
                key={acc.email}
                asChild
                variant={acc.kind === "PRIVATE" ? "default" : "outline"}
                size="sm"
              >
                <a href={`/api/auth/google/connect?kind=${acc.kind}`}>
                  {acc.connected && <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />}
                  {acc.email}
                </a>
              </Button>
            ))}
          </div>
          {!data.oauthConfigured && (
            <p className="text-xs text-amber-400">
              Google OAuth ist noch nicht konfiguriert. Geh erst auf{" "}
              <a href="/settings" className="underline">Einstellungen</a>.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

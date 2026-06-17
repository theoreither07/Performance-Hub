"use client";

import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { Mail, Calendar as CalendarIcon, HeartPulse, Sparkles, AlertTriangle, Check } from "lucide-react";
import { OAuthSetupGuide } from "@/components/settings/oauth-setup-guide";
import { TrainingProfileForm } from "@/components/settings/training-profile-form";
import { KeyLiftsForm } from "@/components/settings/key-lifts-form";
import { DataExport } from "@/components/settings/data-export";
import { PushNotificationsCard } from "@/components/settings/push-notifications-card";

interface AccountStatus {
  email: string;
  kind: "PRIVATE" | "BUSINESS";
  isPrimary: boolean;
  connected: boolean;
}

interface StatusResponse {
  oauthConfigured: boolean;
  accounts: AccountStatus[];
}

export default function SettingsPage() {
  const params = useSearchParams();
  const error = params.get("error");
  const connected = params.get("connected");

  const { data } = useQuery<StatusResponse>({
    queryKey: ["google-accounts"],
    queryFn: async () => {
      const res = await fetch("/api/auth/google/status");
      if (!res.ok) return { oauthConfigured: false, accounts: [] };
      return res.json();
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Einstellungen</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Verbinde Konten und konfiguriere Integrationen.
        </p>
      </div>

      {error === "oauth_not_configured" && (
        <div className="bg-amber-500/10 border border-amber-500/30 text-amber-200 rounded-lg p-3 text-sm flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>Google OAuth ist noch nicht konfiguriert. Anleitung weiter unten.</span>
        </div>
      )}
      {connected && (
        <div className="bg-primary/15 border border-primary/30 rounded-lg p-3 text-sm flex items-center gap-2">
          <Check className="h-4 w-4 text-primary" />
          <span>
            <span className="font-medium">{connected}</span> erfolgreich verbunden.
          </span>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarIcon className="h-4 w-4" /> Google-Konten
          </CardTitle>
          <CardDescription>
            Das private Google-Konto ist Source of Truth fuer den Kalender. Ein optionales
            Business-Konto wird im Dashboard parallel angezeigt.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {data && !data.oauthConfigured && (
            <div className="bg-amber-500/10 border border-amber-500/30 text-amber-200 rounded-lg p-3 text-sm flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">Google OAuth noch nicht konfiguriert.</p>
                <p className="text-xs mt-1 opacity-80">
                  Setup-Anleitung unten — direkt fuer deinen Production-VPS.
                </p>
              </div>
            </div>
          )}
          {(data?.accounts ?? []).map((acc) => (
            <div
              key={acc.email}
              className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3 border border-border rounded-lg"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium truncate">{acc.email}</p>
                  {acc.isPrimary && <Badge variant="biz">Primary</Badge>}
                  {acc.connected ? (
                    <Badge variant="biz">Verbunden</Badge>
                  ) : (
                    <Badge variant="outline">Nicht verbunden</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {acc.kind === "PRIVATE" ? "Privat" : "Business"}
                </p>
              </div>
              {data?.oauthConfigured ? (
                <Button asChild variant={acc.connected ? "outline" : "default"} size="sm">
                  <a href={`/api/auth/google/connect?kind=${acc.kind}`}>
                    {acc.connected ? "Neu verbinden" : "Verbinden"}
                  </a>
                </Button>
              ) : (
                <Button size="sm" disabled>
                  Setup erforderlich
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {data && !data.oauthConfigured && <OAuthSetupGuide />}

      <PushNotificationsCard />
      <TrainingProfileForm />
      <KeyLiftsForm />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-4 w-4" /> Gmail-Inboxen
            <Badge variant="outline" className="ml-1">Phase 3</Badge>
          </CardTitle>
          <CardDescription>
            Aggregierte Inbox aus beiden Google-Konten — kommt in Phase 3 zusammen mit dem Daily
            Coach. Sobald die Google-Konten oben verbunden sind, wird der Gmail-Scope automatisch
            mit aktiviert.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            Geplant: ungelesene Mails nach Account getrennt, &laquo;Needs Reply&raquo;-Filter,
            Schnellantwort direkt vom Dashboard, automatische Verknuepfung mit Projekten/ToDos.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" /> Daily Coach (Phase 3)
          </CardTitle>
          <CardDescription>Anthropic Claude API — taeglicher Morgenbriefing.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" disabled>In Phase 3 verfuegbar</Button>
        </CardContent>
      </Card>

      <DataExport />
    </div>
  );
}

"use client";

import * as React from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, Copy, Globe, MonitorSmartphone } from "lucide-react";

const STORAGE_KEY = "oauth-setup:prod-domain";

function normalize(domain: string): string {
  return domain
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
}

export function OAuthSetupGuide() {
  const [prodDomain, setProdDomain] = React.useState("");
  const [copied, setCopied] = React.useState<string | null>(null);

  React.useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) setProdDomain(stored);
  }, []);

  React.useEffect(() => {
    if (prodDomain) localStorage.setItem(STORAGE_KEY, prodDomain);
    else localStorage.removeItem(STORAGE_KEY);
  }, [prodDomain]);

  const localUri =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/auth/google/callback`
      : "http://localhost:3001/api/auth/google/callback";
  const prodUri = prodDomain ? `https://${normalize(prodDomain)}/api/auth/google/callback` : "";
  const prodEnvUrl = prodDomain ? `https://${normalize(prodDomain)}` : "";

  const copy = (val: string, key: string) => {
    navigator.clipboard.writeText(val);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Google OAuth einrichten</CardTitle>
        <CardDescription>
          Einmalig. Ein OAuth-Client kann mehrere Redirect-URIs haben — trag direkt die
          Production-URI ein, dann musst du das spaeter beim VPS-Deploy nicht nochmal machen.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">
            Production-Domain (geplant fuer den VPS)
          </label>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">https://</span>
            <Input
              placeholder="dashboard.deine-domain.at"
              value={prodDomain}
              onChange={(e) => setProdDomain(e.target.value)}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Wird lokal gespeichert. Spaeter beim Deployen kommt sie als{" "}
            <code className="bg-muted px-1 rounded">NEXTAUTH_URL</code> in die VPS-.env.
          </p>
        </div>

        <ol className="space-y-3 list-decimal list-inside">
          <li>
            <Link
              href="https://console.cloud.google.com/projectcreate"
              target="_blank"
              className="text-primary hover:underline"
            >
              Neues Google-Projekt anlegen
            </Link>{" "}
            (z.B. &laquo;Personal Dashboard&raquo;).
          </li>
          <li>
            <Link
              href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com"
              target="_blank"
              className="text-primary hover:underline"
            >
              Google Calendar API aktivieren
            </Link>
            .
          </li>
          <li>
            <Link
              href="https://console.cloud.google.com/apis/credentials/consent"
              target="_blank"
              className="text-primary hover:underline"
            >
              OAuth Consent Screen
            </Link>{" "}
            anlegen: User Type <span className="font-medium">External</span>, App-Name &laquo;Personal Dashboard&raquo;, Scope{" "}
            <code className="bg-muted px-1 rounded">.../auth/calendar.readonly</code>. Als
            Test-User deine eigene(n) Google-Adresse(n) eintragen.
          </li>
          <li>
            <Link
              href="https://console.cloud.google.com/apis/credentials"
              target="_blank"
              className="text-primary hover:underline"
            >
              Credentials &rarr; OAuth client ID anlegen
            </Link>
            , Typ <span className="font-medium">Web application</span>. Bei{" "}
            <span className="font-medium">Authorized redirect URIs</span> die folgende(n) Zeile(n)
            eintragen — du kannst mehrere haben:
            <div className="mt-2 space-y-2">
              {prodDomain ? (
                <UriRow
                  label="Production (VPS)"
                  uri={prodUri}
                  copied={copied === "prod"}
                  onCopy={() => copy(prodUri, "prod")}
                  icon={<Globe className="h-3.5 w-3.5" />}
                  primary
                />
              ) : (
                <div className="p-2 bg-muted rounded-md text-xs text-muted-foreground">
                  Trag oben deine Production-Domain ein, dann erscheint die URI hier.
                </div>
              )}
              <UriRow
                label="Lokal (optional, fuer Entwicklung)"
                uri={localUri}
                copied={copied === "local"}
                onCopy={() => copy(localUri, "local")}
                icon={<MonitorSmartphone className="h-3.5 w-3.5" />}
              />
            </div>
          </li>
          <li>
            <span className="font-medium">Client ID</span> und{" "}
            <span className="font-medium">Client Secret</span> in deine{" "}
            <span className="font-medium">VPS-.env</span> (und optional auch in lokale{" "}
            <code className="bg-muted px-1 rounded">.env.local</code>):
            <div className="mt-1 relative">
              <pre className="p-3 bg-muted rounded-md font-mono text-xs overflow-x-auto pr-12">
{`GOOGLE_CLIENT_ID="dein-client-id"
GOOGLE_CLIENT_SECRET="dein-secret"
NEXTAUTH_URL="${prodEnvUrl || "https://dashboard.deine-domain.at"}"`}
              </pre>
              {prodDomain && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="absolute top-2 right-2 h-7 w-7 p-0"
                  onClick={() =>
                    copy(
                      `GOOGLE_CLIENT_ID="dein-client-id"\nGOOGLE_CLIENT_SECRET="dein-secret"\nNEXTAUTH_URL="${prodEnvUrl}"`,
                      "env",
                    )
                  }
                  aria-label="Block kopieren"
                >
                  {copied === "env" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              )}
            </div>
          </li>
          <li>
            Auf den VPS deployen (siehe{" "}
            <Link href="/api/docs/deployment" className="text-primary hover:underline">
              Deployment-Anleitung
            </Link>
            ), dann unter {prodDomain ? <code className="bg-muted px-1 rounded">{prodEnvUrl}/settings</code> : "/settings"}{" "}
            auf &laquo;Verbinden&raquo; klicken. Privat-Account zuerst (Source of Truth).
          </li>
        </ol>

        <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          <p className="font-medium text-foreground mb-1">Tipp: Domain noch nicht final?</p>
          Trotzdem moeglich — leg den OAuth-Client jetzt mit Platzhalter an, und ergaenze die
          finale URI spaeter unter &laquo;Credentials &rarr; Edit&raquo;. Google laesst dich URIs
          jederzeit nachpflegen ohne Client neu anzulegen.
        </div>
      </CardContent>
    </Card>
  );
}

function UriRow({
  label,
  uri,
  copied,
  onCopy,
  icon,
  primary,
}: {
  label: string;
  uri: string;
  copied: boolean;
  onCopy: () => void;
  icon: React.ReactNode;
  primary?: boolean;
}) {
  return (
    <div
      className={
        "flex items-center gap-2 p-2 rounded-md font-mono text-xs " +
        (primary ? "bg-primary/10 border border-primary/30" : "bg-muted")
      }
    >
      <span className={"flex items-center gap-1 shrink-0 font-sans " + (primary ? "text-primary" : "text-muted-foreground")}>
        {icon}
        {label}
      </span>
      <span className="flex-1 break-all">{uri}</span>
      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 shrink-0" onClick={onCopy} aria-label="Kopieren">
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
}

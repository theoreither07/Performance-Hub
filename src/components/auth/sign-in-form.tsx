"use client";

import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

export function SignInForm() {
  const params = useSearchParams();
  const error = params.get("error");
  const from = params.get("from") ?? "/";

  return (
    <Card>
      <CardHeader className="text-center">
        <div className="mx-auto h-12 w-12 rounded-lg bg-brand-lime flex items-center justify-center mb-3">
          <span className="font-black text-xl text-brand-black">S</span>
        </div>
        <CardTitle>{process.env.NEXT_PUBLIC_APP_NAME ?? "Personal Dashboard"}</CardTitle>
        <CardDescription>
          Nur fuer autorisierte Konten zugaenglich.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error === "AccessDenied" && (
          <div className="bg-destructive/10 border border-destructive/30 text-destructive rounded-lg p-3 text-sm flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">Zugriff verweigert</p>
              <p className="text-xs mt-1 opacity-80">
                Diese Google-Adresse ist nicht freigeschaltet. Login nur mit den in der
                Konfiguration hinterlegten Adressen moeglich.
              </p>
            </div>
          </div>
        )}
        {error === "Configuration" && (
          <div className="bg-amber-500/10 border border-amber-500/30 text-amber-200 rounded-lg p-3 text-sm">
            OAuth ist nicht korrekt konfiguriert. Pruefe GOOGLE_CLIENT_ID/SECRET und NEXTAUTH_URL.
          </div>
        )}
        <Button
          className="w-full"
          size="lg"
          onClick={() => signIn("google", { callbackUrl: from })}
        >
          <svg className="h-4 w-4 mr-2" viewBox="0 0 24 24">
            <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          Mit Google anmelden
        </Button>
        <p className="text-xs text-muted-foreground text-center">
          Du wirst zu Google weitergeleitet. Nutze einen der autorisierten Accounts.
        </p>
      </CardContent>
    </Card>
  );
}

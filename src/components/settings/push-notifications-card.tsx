"use client";

/**
 * Push-Notifications Setup Card fuer /settings.
 * Permission anfordern, Subscribe, Test-Push, Unsubscribe.
 */
import * as React from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { Bell, BellOff } from "lucide-react";

function urlBase64ToUint8Array(base64: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const buf = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return buf;
}

export function PushNotificationsCard() {
  const toast = useToast();
  const [permission, setPermission] = React.useState<NotificationPermission | "unsupported">("default");
  const [subscribed, setSubscribed] = React.useState<boolean>(false);

  React.useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setPermission("unsupported");
      return;
    }
    setPermission(Notification.permission);
    navigator.serviceWorker.ready.then(async (reg) => {
      const sub = await reg.pushManager.getSubscription();
      setSubscribed(!!sub);
    });
  }, []);

  const keyQ = useQuery<{ vapidPublicKey: string }>({
    queryKey: ["push-vapid-key"],
    queryFn: async () => {
      const res = await fetch("/api/push/subscribe");
      if (!res.ok) throw new Error("vapid");
      return res.json();
    },
    staleTime: Infinity,
  });

  const subscribe = useMutation({
    mutationFn: async () => {
      if (!keyQ.data?.vapidPublicKey) throw new Error("no_vapid");
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") throw new Error("denied");

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(keyQ.data.vapidPublicKey),
      });

      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: sub.endpoint,
          keys: {
            p256dh: btoa(String.fromCharCode(...new Uint8Array(sub.getKey("p256dh") ?? new ArrayBuffer(0)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
            auth: btoa(String.fromCharCode(...new Uint8Array(sub.getKey("auth") ?? new ArrayBuffer(0)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
          },
          userAgent: navigator.userAgent,
        }),
      });
      if (!res.ok) throw new Error("save");
      setSubscribed(true);
    },
    onSuccess: () => toast.success("Notifications aktiviert", "Du bekommst jetzt Push-Updates."),
    onError: (e) => toast.error("Aktivierung fehlgeschlagen", e instanceof Error ? e.message : "unbekannt"),
  });

  const unsubscribe = useMutation({
    mutationFn: async () => {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch(`/api/push/subscribe?endpoint=${encodeURIComponent(sub.endpoint)}`, { method: "DELETE" });
        await sub.unsubscribe();
      }
      setSubscribed(false);
    },
    onSuccess: () => toast.info("Notifications deaktiviert"),
  });

  const sendTest = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/push/test", { method: "POST" });
      if (!res.ok) throw new Error("test");
      return res.json() as Promise<{ sent: number }>;
    },
    onSuccess: (d) => {
      if (d.sent > 0) toast.success(`Test gesendet an ${d.sent} Device${d.sent === 1 ? "" : "s"}`);
      else toast.error("Keine aktive Subscription", "Aktiviere Notifications zuerst.");
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {subscribed ? <Bell className="h-4 w-4 text-emerald-300" /> : <BellOff className="h-4 w-4 text-muted-foreground" />}
          Push-Notifications
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {permission === "unsupported" ? (
          <p className="text-sm text-muted-foreground italic">
            Dein Browser unterstützt keine Push-Notifications. (Safari iOS: nur als installierte PWA.)
          </p>
        ) : permission === "denied" ? (
          <p className="text-sm text-amber-300">
            Notifications sind im Browser-Setting blockiert. Manuell freigeben → Reload.
          </p>
        ) : !subscribed ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Coach kann dir morgens das Briefing senden, abends Wind-Down-Reminder, oder bei kritischen Watchouts piepen.
            </p>
            <Button onClick={() => subscribe.mutate()} disabled={subscribe.isPending} size="sm">
              <Bell className="h-3.5 w-3.5 mr-1.5" />
              {subscribe.isPending ? "..." : "Aktivieren"}
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => sendTest.mutate()} variant="outline" size="sm" disabled={sendTest.isPending}>
              {sendTest.isPending ? "..." : "Test-Push senden"}
            </Button>
            <Button onClick={() => unsubscribe.mutate()} variant="ghost" size="sm" disabled={unsubscribe.isPending}>
              Deaktivieren
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

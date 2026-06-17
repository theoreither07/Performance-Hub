// Personal Dashboard Service Worker — v57+
// Strategie:
// - HTML/Navigation: Network-first, Cache nur Fallback bei offline (kein Stale-Flicker)
// - JS/CSS-Assets mit Hash im Pfad: Cache-first (immutable)
// - GET-API (health/coach/calendar): Stale-While-Revalidate — Cache sofort, Netz im Hintergrund
// - andere GET-API: Network-first mit Cache-Fallback
// - Mutations (POST/PUT/PATCH/DELETE): Bypass SW komplett

const CACHE = "dashboard-v98";
const APP_SHELL = ["/manifest.webmanifest"];

// API-Pfade die per Stale-While-Revalidate cachebar sind.
// Achtung: /api/health/* und /api/coach/* sind hier RAUS — die aendern sich
// nach Garmin-Sync sofort, und der SWR-Pattern blockierte das Sichtbar-Werden
// (React Query bekam den alten Cache zurueck, neue Daten kamen erst nach Refetch+TTL).
// Drin nur noch: weather (selten geandert) + calendar (Google liefert quick).
const SWR_API_PATTERNS = [
  /^\/api\/calendar\/(week|today|range)/,
  /^\/api\/weather/,
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(APP_SHELL).catch(() => {})),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

function isHtmlRequest(req) {
  if (req.mode === "navigate") return true;
  if (req.destination === "document") return true;
  const accept = req.headers.get("accept") || "";
  return accept.includes("text/html");
}

function isImmutableAsset(url) {
  return url.pathname.startsWith("/_next/static/");
}

function isSwrApi(url) {
  return SWR_API_PATTERNS.some((re) => re.test(url.pathname));
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // HTML/Navigation → Network-first MIT 3s-Timeout (verhindert Hang auf langsamer Mobile-Verbindung)
  if (isHtmlRequest(req)) {
    event.respondWith(
      (async () => {
        const cachePromise = caches.match(req);
        const networkPromise = fetch(req)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
            }
            return res;
          });
        let networkSettled = false;
        const networkRace = networkPromise.then((r) => { networkSettled = true; return r; });
        const timeout = new Promise((resolve) => setTimeout(() => {
          if (!networkSettled) resolve(null);
        }, 3000));
        try {
          const winner = await Promise.race([networkRace, timeout]);
          if (winner) return winner;
          const cached = await cachePromise;
          if (cached) return cached;
          return (await networkPromise.catch(() => null)) || (await caches.match("/")) || new Response("offline", { status: 503 });
        } catch {
          const cached = await cachePromise;
          return cached || (await caches.match("/")) || new Response("offline", { status: 503 });
        }
      })(),
    );
    return;
  }

  // Immutable Next-Assets → Cache-first
  if (isImmutableAsset(url)) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        });
      }),
    );
    return;
  }

  // SWR-API → SOFORT Cache zurueckgeben, parallel Netz fetchen + Cache updaten
  if (isSwrApi(url)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(req);
        const networkPromise = fetch(req)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
            }
            return res;
          })
          .catch(() => null);
        // Wenn Cache da → SOFORT zurueck, Netz updatet im Hintergrund
        if (cached) {
          networkPromise.then((res) => {
            if (res && res.ok) {
              // Notify clients dass frische Daten da sind (fuer optional React-Query-invalidate)
              self.clients.matchAll().then((clients) => {
                clients.forEach((c) => c.postMessage({ type: "swr-updated", url: req.url }));
              });
            }
          });
          return cached;
        }
        // Kein Cache → auf Netz warten
        const netRes = await networkPromise;
        return netRes || new Response(JSON.stringify({ error: "offline" }), {
          status: 503,
          headers: { "content-type": "application/json" },
        });
      })(),
    );
    return;
  }

  // Andere GETs → Network-first mit Cache-Fallback
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || new Response("offline", { status: 503 }))),
  );
});

// Client triggert SW-Cache-Purge fuer /api/health/* + /api/coach/* nach Refresh-Mutation.
// Verhindert, dass nach Garmin-Sync der alte SW-Cache die fresh Daten ueberschreibt.
self.addEventListener("message", (event) => {
  if (event.data?.type === "purge-health-cache") {
    event.waitUntil((async () => {
      const c = await caches.open(CACHE);
      const keys = await c.keys();
      await Promise.all(
        keys
          .filter((req) => {
            const u = new URL(req.url);
            return /^\/api\/(health|coach)\//.test(u.pathname);
          })
          .map((req) => c.delete(req)),
      );
    })());
  }
});

// Sync-Engine triggert SW von der Hauptseite. Wenn Background Sync verfuegbar:
self.addEventListener("sync", (event) => {
  if (event.tag === "dashboard-sync") {
    event.waitUntil(
      self.clients.matchAll().then((clients) => {
        clients.forEach((c) => c.postMessage({ type: "sync-now" }));
      }),
    );
  }
});

// Web-Push: Server schickt eine Notification, SW zeigt sie an.
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload = { title: "Dashboard", body: "", url: "/", tag: "" };
  try {
    payload = { ...payload, ...event.data.json() };
  } catch {
    payload.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag || "dashboard",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: payload.url || "/" },
    }),
  );
});

// Klick auf Notification öffnet die URL.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    }),
  );
});

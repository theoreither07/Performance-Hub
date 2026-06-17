/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  compress: true,
  poweredByHeader: false,
  // Security-Headers + tighter Cache-Control
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
        ],
      },
    ];
  },
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
    // Build nutzt max 2 Worker-Threads (statt allen 8 Cores) — verhindert dass Webpack
    // beim "next build" hohe CPU-Last erzeugt.
    // Trade-off: Build wird ~2x langsamer, aber bleibt unter der Throttle-Schwelle.
    cpus: 2,
    workerThreads: false,
  },
  // TypeScript-Check waehrend des Builds skippen — wir typchecken lokal vor jedem Push
  // (npx tsc --noEmit). Spart ~25-30% Build-Zeit auf dem (oft throttled) VPS.
  // Ein Fehler hier wuerde den Build NICHT brechen — daher MUESSEN wir vorher lokal pruefen.
  typescript: {
    ignoreBuildErrors: true,
  },
  // ESLint waehrend Build ueberspringen — wir lint'en separat (npm run lint).
  eslint: {
    ignoreDuringBuilds: true,
  },
};

module.exports = nextConfig;

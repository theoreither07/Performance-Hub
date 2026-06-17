# Personal Dashboard

A self-hostable personal dashboard (PWA) that brings **to-dos, projects, calendar, mail, health
metrics and an AI training coach** together in one place. Offline-first, installable on mobile,
deployable with Docker.

> Single-user by design — you run your own instance for your own data. No multi-tenant SaaS.

## Features

- **To-Dos & Projects** — quick capture, life-areas (private / work / study), priorities, due dates,
  a drag-and-drop **Kanban board** and inline project assignment. Offline-first with a sync queue.
- **Calendar** — aggregates one or more Google Calendars (private + optional business account).
- **Mail** — unified Gmail inbox view across the connected Google accounts.
- **Health** — syncs Garmin metrics (HRV, sleep, resting HR, body battery, workouts) and computes
  a sport-science readiness/vitality score (Plews HRV method, CTL/ATL/TSB, type-specific recovery).
- **AI Coach** — generates and refines weekly training plans and daily briefings via Claude
  (with an optional Nvidia NIM fallback). Optional MCP server for Claude Desktop access.
- **PWA** — installable, offline-capable, web-push notifications.

## Tech Stack

Next.js 15 (App Router) · TypeScript · Tailwind CSS · Prisma + PostgreSQL · TanStack Query ·
Dexie (IndexedDB) for offline · NextAuth (Google OAuth) · Docker.

## Quick Start (local)

```bash
# 1. Install deps
npm install

# 2. Configure env
cp .env.example .env       # then fill in the values (see below)

# 3. Start Postgres (e.g. via Docker) and push the schema
npx prisma migrate deploy
npx prisma generate

# 4. Run
npm run dev                # http://localhost:3000
```

### Minimum configuration

At minimum set these in `.env`:

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth (sign-in + calendar/mail) |
| `PRIMARY_EMAIL` | your Google address (the account the dashboard shows) |
| `ALLOWED_EMAILS` | comma-separated allowlist of who may sign in |

Garmin, Anthropic/Nvidia, web-push and MCP are all **optional** — leave them blank to disable
those features. See `.env.example` for the full list.

## Deployment (Docker)

A production `docker-compose.yml` is included (Next.js standalone + Postgres + nightly backups).
Put a reverse proxy with HTTPS in front of it (a sample `Caddyfile` is included; nginx works too).

```bash
cp .env.example .env        # fill in production values
docker compose up -d --build
```

The app container runs hardened by default: **read-only root filesystem**, `noexec` tmpfs for
scratch dirs, dropped Linux capabilities and `no-new-privileges`. Keep these in place.

## Architecture notes

- **Offline-first:** every mutation writes to IndexedDB (Dexie) first, then a sync queue pushes it
  to the server. Conflict resolution is last-write-wins on `updatedAt`.
- **Server is source of truth.** API routes validate input with Zod and return typed JSON.
- **Modular by domain:** `todos`, `projects`, `health`, `calendar` each have their own folders.

## License

[MIT](./LICENSE) — use it, fork it, host it. No warranty.

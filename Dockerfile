# Multi-stage Build fuer Next.js 15 (standalone output)
# syntax=docker/dockerfile:1.7  ← aktiviert BuildKit-Cache-Mounts (RUN --mount=type=cache,...).
#
# Cache-Strategie:
#  - npm-cache als persistenter Mount → npm ci wird auch bei lock-file-Aenderung nicht von 0 gezogen
#  - .next/cache als persistenter Mount → Webpack inkrementell, 2.-N. Build ~3x schneller
#
# syntax=docker/dockerfile:1.7

FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm,sharing=locked npm ci

FROM node:20-alpine AS builder
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
# .next/cache als Cache-Mount: Webpack-Cache ueberlebt zwischen Builds → inkrementell.
RUN --mount=type=cache,target=/app/.next/cache,sharing=locked npm run build

FROM node:20-alpine AS runner
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]

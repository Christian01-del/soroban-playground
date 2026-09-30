# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────────
# Frontend Dockerfile for the Soroban Playground (issue #980 cleanup).
#
# Four stages:
#   * deps     - lockfile-aware install (full deps, including dev).
#   * builder  - runs `npm run build` and prunes to prod-only deps. The
#                resulting image layer is the smallest possible source of
#                truth for the runtime stage.
#   * dev      - default stage used by `docker compose up`. Wires in
#                CHOKIDAR polling so Next.js hot reload works on macOS /
#                Windows bind mounts. Reuses the `deps` layer as-is.
#   * runtime  - production target. Slim, non-root, tini as PID 1, node-
#                based healthcheck. The default when no `--target` is
#                passed (matches a future
#                `docker build -t soroban-playground-frontend:ci frontend`).
#
# Notes:
# - The base image is pinned to `node:20-alpine3.20` for parity with the
#   backend Dockerfile (reproducible layer cache + same CVE baseline as the
#   security-audit scan).
# - The Next.js `next start` server honors the `PORT` env var.
# - We intentionally do NOT install `wget`; the healthcheck is a one-liner
#   `node -e` script, which works in every stage.
# ─────────────────────────────────────────────────────────────────────────────

# Stage 1 — full dependency install (used by both `builder` and `dev`).
FROM node:20-alpine3.20 AS deps
WORKDIR /app

# hadolint ignore=DL3018 -- base libc6-compat is intentionally unpinned; it tracks the Alpine 3.20 base image
RUN apk add --no-cache libc6-compat

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Stage 2 — production build. Reuses `deps` and runs `next build`, then
# prunes dev dependencies so the resulting layer is production-only.
FROM node:20-alpine3.20 AS builder
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build \
    && npm prune --omit=dev

# Stage 3 — development (default for docker compose). Reuses the full
# `deps` (including dev tooling) and bind-mounts source at runtime.
FROM node:20-alpine3.20 AS dev
WORKDIR /app
ENV NODE_ENV=development
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV CHOKIDAR_USEPOLLING=true
ENV PORT=3000
EXPOSE 3000

CMD ["npm", "run", "dev"]

# Stage 4 — runtime. Pulls the pre-built `.next/` + pruned node_modules +
# manifest from `builder`. No `wget`, no dev tooling, no source-level
# secrets (filter list in `.dockerignore`).
FROM node:20-alpine3.20 AS runtime

# hadolint ignore=DL3018 -- tini tracks the Alpine 3.20 base image
RUN apk add --no-cache tini

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

# Order matters: copy the pruned node_modules first, then the build
# output and manifest on top. Do NOT copy `deps` here — that would
# reintroduce dev dependencies.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json

RUN chown -R node:node /app
USER node

EXPOSE 3000

# Node-based healthcheck (no extra system packages required). Hitting
# `/` is robust: Next.js returns 200 on a healthy app, 404 only if the
# route truly doesn't exist (which the listener is what we want to know).
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/',r=>process.exit(r.statusCode<400?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["tini", "--"]
CMD ["npm", "run", "start"]

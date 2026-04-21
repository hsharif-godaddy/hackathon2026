# syntax=docker/dockerfile:1.6
FROM 764525110978.dkr.ecr.us-west-2.amazonaws.com/node:22-alpine AS builder

USER root

RUN mkdir -p /home/node && chown node:node /home/node

RUN apk add --no-cache openssl

WORKDIR /workspace

# Copy workspace files first (for pnpm workspace setup)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./

# Install pnpm via corepack (version from packageManager in package.json)
RUN corepack enable && corepack install
COPY debug-console/package.json ./debug-console/

ENV NODE_ENV=production

# Install dependencies using pnpm workspace
# Secret mount injects Artifactory token at build time without persisting in layers
# Cache mount persists pnpm store across builds, avoiding redundant downloads
RUN --mount=type=secret,id=npmrc,target=/workspace/.npmrc \
    --mount=type=cache,id=pnpm-store-debug-console,target=/root/.local/share/pnpm/store \
    pnpm install --filter debug-console --frozen-lockfile

# Copy debug-console source code
COPY debug-console/ ./debug-console/

WORKDIR /workspace/debug-console

# Generate self-signed SSL certificates BEFORE build
# ALB will do SSL termination, this cert is for backend HTTPS and local dev
RUN mkdir -p certs && \
    openssl req -x509 -newkey rsa:4096 -keyout certs/server.key -out certs/server.crt \
    -days 365 -nodes -subj "/C=US/ST=CA/L=San Francisco/O=Airo/CN=*" \
    -addext "subjectAltName=DNS:*,IP:127.0.0.1,IP:0.0.0.0"

# Build Next.js application
RUN pnpm build

# --- Runtime stage ---
# COPY --chown sets ownership inline during copy (single pass),
# avoiding the slow recursive chown that duplicates every file into a new layer
FROM 764525110978.dkr.ecr.us-west-2.amazonaws.com/node:22-alpine

USER root

RUN mkdir -p /home/node && chown node:node /home/node

RUN apk add --no-cache wget

# Copy workspace first so corepack can read packageManager from package.json
COPY --from=builder --chown=node:node /workspace /workspace

WORKDIR /workspace

# pnpm is required at runtime: CMD uses `pnpm start` to launch the Next.js server
RUN corepack enable && corepack install

WORKDIR /workspace/debug-console
USER node

ENV NODE_ENV=production
ENV PORT=8443

EXPOSE 8443

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider --no-check-certificate https://localhost:8443/api/health || exit 1

CMD ["pnpm", "start"]

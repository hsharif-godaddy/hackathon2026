# syntax=docker/dockerfile:1.6

# --- Prune stage: create minimal workspace subset ---
FROM 764525110978.dkr.ecr.us-west-2.amazonaws.com/node:22-alpine AS pruner

USER root
RUN mkdir -p /home

RUN npm install -g turbo@2.8.17

WORKDIR /workspace

COPY . .

RUN turbo prune website --docker

# --- Builder stage: install, compile ---
FROM 764525110978.dkr.ecr.us-west-2.amazonaws.com/node:22-alpine AS builder

# Switch to root to install packages, then switch back to node user
USER root
RUN mkdir -p /home

RUN apk add --no-cache openssl wget

WORKDIR /workspace

# Copy only package.json files + lockfile (install layer cache)
COPY --from=pruner /workspace/out/json/ /workspace/
COPY --from=pruner /workspace/out/pnpm-lock.yaml /workspace/
COPY --from=pruner /workspace/out/pnpm-workspace.yaml /workspace/

# Install pnpm via corepack (version from packageManager in package.json)
RUN corepack enable && corepack install

ENV NEXT_TELEMETRY_DISABLED=1

# Install dependencies using pnpm workspace
# Secret mount injects Artifactory token at build time without persisting in layers
# Cache mount persists pnpm store across builds, avoiding redundant downloads
RUN --mount=type=secret,id=npmrc,target=/workspace/.npmrc \
    --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# Copy full source (only invalidates on actual code changes, not install layer)
COPY --from=pruner /workspace/out/full/ /workspace/

# Build upstream package dependencies of the app
RUN pnpm exec turbo run build --filter=website^...

WORKDIR /workspace/app

# Generate self-signed SSL certificates BEFORE build (gasket.ts needs them)
# ALB will do SSL termination, this cert is for backend HTTPS and local dev
RUN mkdir -p /workspace/app/certs && \
    openssl req -x509 -newkey rsa:4096 -keyout /workspace/app/certs/server.key -out /workspace/app/certs/server.crt \
    -days 365 -nodes -subj "/C=US/ST=CA/L=San Francisco/O=Airo/CN=*" \
    -addext "subjectAltName=DNS:*,IP:127.0.0.1,IP:0.0.0.0"

RUN pnpm prebuild && pnpm build

RUN mkdir -p /workspace/app/data && chown -R node:node /workspace/app

USER node

# Set NODE_OPTIONS to load OpenTelemetry instrumentation with absolute path
ENV NODE_OPTIONS="--import /workspace/app/otel-setup.js"

EXPOSE 8443

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider --no-check-certificate https://localhost:8443/api/health || exit 1

CMD ["pnpm", "start"]

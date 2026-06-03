FROM 764525110978.dkr.ecr.us-west-2.amazonaws.com/node:22-alpine AS builder

USER root

RUN mkdir -p /home/node && chown node:node /home/node

# openssl: self-signed cert generation
RUN apk add --no-cache openssl

WORKDIR /workspace

# Copy workspace files first (for pnpm workspace setup)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./

# Install pnpm via corepack (version from packageManager in package.json)
RUN corepack enable && corepack install

COPY notification-service/package.json ./notification-service/
# Workspace package manifests are needed at install time so pnpm can resolve
# the `workspace:*` references in notification-service's deps. We don't yet copy
# their source — that comes after install so changes to package source
# don't bust the install cache layer.
COPY packages/ ./packages/

# NOTE: NODE_ENV is intentionally NOT set here. Workspace packages need their
# devDependencies (most importantly `typescript`) installed so `tsc` can run.
# Setting NODE_ENV=production before install would skip devDeps and break the build.

# Install dependencies using pnpm workspace
# Secret mount injects Artifactory token at build time without persisting in layers
# Cache mount persists pnpm store across builds, avoiding redundant downloads
RUN --mount=type=secret,id=npmrc,target=/workspace/.npmrc \
    --mount=type=cache,id=pnpm-store-notification-service,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# Copy notification-service source code
COPY notification-service/ ./notification-service/

# Generate self-signed TLS cert for the health endpoint
RUN mkdir -p notification-service/certs && \
    openssl req -x509 -newkey rsa:4096 -keyout notification-service/certs/server.key -out notification-service/certs/server.crt \
    -days 365 -nodes -subj "/C=US/ST=CA/L=San Francisco/O=Airo/CN=*" \
    -addext "subjectAltName=DNS:*,IP:127.0.0.1,IP:0.0.0.0"

# Compile TypeScript
RUN pnpm --filter @airo/notification-service run build

# --- Runtime stage ---
# COPY --chown sets ownership inline during copy (single pass),
# avoiding the slow recursive chown that duplicates every file into a new layer
FROM 764525110978.dkr.ecr.us-west-2.amazonaws.com/node:22-alpine

USER root

RUN mkdir -p /home/node && chown node:node /home/node

RUN apk add --no-cache wget

# Copy workspace so corepack can read packageManager from package.json
COPY --from=builder --chown=node:node /workspace /workspace

WORKDIR /workspace

# pnpm is required at runtime to resolve the node_modules symlink graph
RUN corepack enable && corepack install

WORKDIR /workspace/notification-service
USER node

ENV NODE_ENV=production

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider --no-check-certificate https://localhost:8080/health || exit 1

CMD ["pnpm", "start"]

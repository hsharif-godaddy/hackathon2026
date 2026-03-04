# syntax=docker/dockerfile:1.6
FROM 764525110978.dkr.ecr.us-west-2.amazonaws.com/node:22-alpine AS builder

# Switch to root to install packages, then switch back to node user
USER root

RUN apk add --no-cache openssl wget

# Install pnpm globally (pinned to 10.17.0)
RUN npm install -g pnpm@10.17.0+sha512.fce8a3dd29a4ed2ec566fb53efbb04d8c44a0f05bc6f24a73046910fb9c3ce7afa35a0980500668fa3573345bd644644fa98338fa168235c80f4aa17aa17fbef

WORKDIR /workspace

# Copy workspace files first (for pnpm workspace setup)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY app/package.json ./app/
COPY packages/shared/package.json ./packages/shared/
COPY packages/ai-lib/package.json ./packages/ai-lib/
COPY app/.npmrc ./

ENV NEXT_TELEMETRY_DISABLED=1

# Install dependencies using pnpm workspace
RUN pnpm install

# Copy shared and ai-lib sources and build them (app depends on both workspace packages)
COPY packages/shared/ ./packages/shared/
RUN pnpm --filter @airo/shared build

COPY packages/ai-lib/ ./packages/ai-lib/
RUN pnpm --filter @airo/ai-lib build

# Copy app source code
COPY app/ ./app/

WORKDIR /workspace/app

# Generate self-signed SSL certificates BEFORE build (gasket.ts needs them)
# ALB will do SSL termination, this cert is for backend HTTPS and local dev
RUN mkdir -p /workspace/app/certs && \
    openssl req -x509 -newkey rsa:4096 -keyout /workspace/app/certs/server.key -out /workspace/app/certs/server.crt \
    -days 365 -nodes -subj "/C=US/ST=CA/L=San Francisco/O=Airo/CN=*" \
    -addext "subjectAltName=DNS:*,IP:127.0.0.1,IP:0.0.0.0"

# Generate Prisma client for Alpine Linux platform (required for build)
ENV PRISMA_CLI_QUERY_ENGINE_TYPE=binary
ENV PRISMA_CLIENT_ENGINE_TYPE=binary
RUN pnpm prebuild && pnpm build

RUN mkdir -p /workspace/app/data && chown -R node:node /workspace/app

USER node

# Set NODE_OPTIONS to load OpenTelemetry instrumentation with absolute path
ENV NODE_OPTIONS="--import /workspace/app/otel-setup.js"

EXPOSE 8443

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider --no-check-certificate https://localhost:8443/api/health || exit 1

CMD ["pnpm", "start"]

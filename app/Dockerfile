# syntax=docker/dockerfile:1.6
FROM 764525110978.dkr.ecr.us-west-2.amazonaws.com/node:22-alpine AS builder

# Switch to root to install packages, then switch back to node user
USER root

RUN apk add --no-cache openssl wget

# Install pnpm globally
RUN npm install -g pnpm

WORKDIR /app

# Copy .npmrc for private registry authentication
COPY .npmrc ./

COPY package.json ./

ENV NEXT_TELEMETRY_DISABLED=1

# Install dependencies with BuildKit cache mounts (pnpm store + cache)
RUN --mount=type=cache,id=pnpm-store,target=/root/.pnpm-store \
    --mount=type=cache,id=pnpm-cache,target=/root/.cache/pnpm \
    pnpm install && rm -f .npmrc

# Generate self-signed SSL certificates BEFORE build (gasket.ts needs them)
# ALB will do SSL termination, this cert is for backend HTTPS and local dev
RUN mkdir -p /app/certs && \
    openssl req -x509 -newkey rsa:4096 -keyout /app/certs/server.key -out /app/certs/server.crt \
    -days 365 -nodes -subj "/C=US/ST=CA/L=San Francisco/O=Airo/CN=*" \
    -addext "subjectAltName=DNS:*,IP:127.0.0.1,IP:0.0.0.0"

# Copy application code (separate layer for better caching)
COPY . /app/

# Generate Prisma client for Alpine Linux platform (required for build)
ENV PRISMA_CLI_QUERY_ENGINE_TYPE=binary
ENV PRISMA_CLIENT_ENGINE_TYPE=binary
RUN pnpm prebuild && pnpm build

WORKDIR /app

RUN mkdir -p /app/data && chown -R node:node /app

USER node

EXPOSE 8443

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider --no-check-certificate https://localhost:8443/api/health || exit 1

CMD ["pnpm", "start"]

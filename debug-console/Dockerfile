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
COPY debug-console/package.json ./debug-console/
# Copy .npmrc if it exists (created by workflow for Artifactory auth)
COPY debug-console/.npmrc* ./

ENV NODE_ENV=production

# Install dependencies using pnpm workspace
RUN pnpm install --filter debug-console --frozen-lockfile

# Copy debug-console source code
COPY debug-console/ ./debug-console/

WORKDIR /workspace/debug-console

# Generate self-signed SSL certificates BEFORE build
# ALB will do SSL termination, this cert is for backend HTTPS and local dev
RUN mkdir -p /workspace/debug-console/certs && \
    openssl req -x509 -newkey rsa:4096 -keyout /workspace/debug-console/certs/server.key -out /workspace/debug-console/certs/server.crt \
    -days 365 -nodes -subj "/C=US/ST=CA/L=San Francisco/O=Airo/CN=*" \
    -addext "subjectAltName=DNS:*,IP:127.0.0.1,IP:0.0.0.0"

# Build Next.js application
RUN pnpm build

RUN chown -R node:node /workspace

USER node

ENV NODE_ENV=production
ENV PORT=8443

EXPOSE 8443

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider --no-check-certificate https://localhost:8443/api/health || exit 1

CMD ["pnpm", "start"]

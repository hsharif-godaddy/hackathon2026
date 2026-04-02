# syntax=docker/dockerfile:1.6
FROM 764525110978.dkr.ecr.us-west-2.amazonaws.com/node:22-alpine AS builder

USER root

RUN apk add --no-cache openssl

RUN npm install -g pnpm@10.17.0+sha512.fce8a3dd29a4ed2ec566fb53efbb04d8c44a0f05bc6f24a73046910fb9c3ce7afa35a0980500668fa3573345bd644644fa98338fa168235c80f4aa17aa17fbef

WORKDIR /workspace

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY blog/package.json ./blog/
COPY packages/eslint-config-airo ./packages/eslint-config-airo/

RUN --mount=type=secret,id=npmrc,target=/workspace/.npmrc \
    --mount=type=cache,id=pnpm-store-blog,target=/root/.local/share/pnpm/store \
    pnpm install --filter blog --frozen-lockfile

COPY blog/ ./blog/

WORKDIR /workspace/blog

ARG PUBLIC_DEPLOY_ENV=prod
ENV PUBLIC_DEPLOY_ENV=${PUBLIC_DEPLOY_ENV}

RUN pnpm build

FROM 764525110978.dkr.ecr.us-west-2.amazonaws.com/node:22-alpine

USER root

RUN apk add --no-cache openssl wget && \
    npm install -g serve@14.2.4

RUN mkdir -p /certs && \
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout /certs/key.pem -out /certs/cert.pem \
    -subj "/C=US/ST=CA/L=San Francisco/O=Airo/CN=*" && chown -R node:node /certs

WORKDIR /app

RUN mkdir -p dist/blog
COPY --from=builder --chown=node:node /workspace/blog/dist/. ./dist/blog/
RUN echo 'ok' > ./dist/healthz

USER node

ENV NODE_ENV=production

EXPOSE 8443

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider --no-check-certificate https://127.0.0.1:8443/healthz || exit 1

CMD ["serve", "dist", "-l", "8443", "--ssl-cert", "/certs/cert.pem", "--ssl-key", "/certs/key.pem"]

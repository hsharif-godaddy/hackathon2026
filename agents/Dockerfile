ARG UPSTREAM_VERSION=22

# --- Prune stage: create minimal workspace subset ---
FROM 764525110978.dkr.ecr.us-west-2.amazonaws.com/node:${UPSTREAM_VERSION}-alpine AS pruner

USER root

RUN npm install -g turbo@2.8.17

WORKDIR /workspace

COPY . .

RUN turbo prune @airo/agents --docker

# --- Builder stage: install, compile, deploy ---
FROM 764525110978.dkr.ecr.us-west-2.amazonaws.com/node:${UPSTREAM_VERSION}-alpine AS builder

USER root

RUN apk add --no-cache python3 py3-setuptools make g++

ENV CI=true

RUN mkdir -p /home
RUN addgroup -S -g 790 agent
RUN adduser -S -G agent -u 790 agent

RUN mkdir -p /workspace && chown agent:agent /workspace

USER agent

WORKDIR /workspace

# Copy only package.json files + lockfile (install layer cache)
COPY --from=pruner --chown=agent:agent /workspace/out/json/ /workspace/
COPY --from=pruner --chown=agent:agent /workspace/out/pnpm-lock.yaml /workspace/
COPY --from=pruner --chown=agent:agent /workspace/out/pnpm-workspace.yaml /workspace/

# Install pnpm via corepack (version from packageManager in package.json)
# corepack enable requires root for /usr/local/bin symlinks
USER root
RUN corepack enable && corepack install
USER agent

RUN --mount=type=secret,id=npm_token,uid=790 \
  printf "//gdartifactory1.jfrog.io/artifactory/api/npm/node-virt/:_authToken=%s\n//gdartifactory1.jfrog.io/artifactory/api/npm/node-virt/:always-auth=true\nregistry=https://gdartifactory1.jfrog.io/artifactory/api/npm/node-virt/\n" "$(cat /run/secrets/npm_token)" > ~/.npmrc && \
  pnpm install --frozen-lockfile && \
  rm -f ~/.npmrc

# Copy full source (only invalidates on actual code changes, not install layer)
COPY --from=pruner --chown=agent:agent /workspace/out/full/ /workspace/

RUN pnpm exec turbo run build --filter=@airo/agents

RUN cp -r /workspace/agents/src/prompts /workspace/agents/dist/
RUN cp -r /workspace/agents/src/skills /workspace/agents/dist/
RUN cp -r /workspace/agents/src/reference /workspace/agents/dist/
RUN cp -r /workspace/agents/src/utils/lucide-icons-map.js /workspace/agents/dist/utils/lucide-icons-map.js

# Create a self-contained deployment with production deps only
RUN --mount=type=secret,id=npm_token,uid=790 \
  printf "//gdartifactory1.jfrog.io/artifactory/api/npm/node-virt/:_authToken=%s\n//gdartifactory1.jfrog.io/artifactory/api/npm/node-virt/:always-auth=true\nregistry=https://gdartifactory1.jfrog.io/artifactory/api/npm/node-virt/\n" "$(cat /run/secrets/npm_token)" > ~/.npmrc && \
  pnpm --filter=@airo/agents deploy --legacy --prod /workspace/deploy && \
  rm -f ~/.npmrc

# --- Runtime stage: minimal image ---
FROM 764525110978.dkr.ecr.us-west-2.amazonaws.com/node:${UPSTREAM_VERSION}-alpine

USER root

RUN apk add --no-cache git ffmpeg

RUN mkdir -p /home
RUN addgroup -S -g 790 agent
RUN adduser -S -G agent -u 790 agent

RUN mkdir -p /workspace/agents && chown -R agent:agent /workspace

# Copy the self-contained deployment (dist + production node_modules)
COPY --from=builder --chown=agent:agent /workspace/deploy /workspace/agents

# Copy management scripts from builder (consistent with multi-stage pattern)
RUN mkdir -p /management-scripts
COPY --from=builder --chown=agent:agent /workspace/agents/management-scripts/* /management-scripts/
RUN chmod +x /management-scripts/*.sh

RUN mkdir -p /workspace/agents/data && chown agent:agent /workspace/agents/data

USER agent

WORKDIR /workspace/agents

ENV NODE_ENV=production

ENTRYPOINT ["/management-scripts/nomad_setup_and_serve.sh"]
CMD ["node", "/workspace/agents/dist/server/app.js"]

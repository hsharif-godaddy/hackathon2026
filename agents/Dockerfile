ARG UPSTREAM_VERSION=22

FROM 764525110978.dkr.ecr.us-west-2.amazonaws.com/node:${UPSTREAM_VERSION}-alpine

USER root

RUN apk add --no-cache python3 py3-setuptools make g++ git

RUN npm install -g pnpm@10.17.0+sha512.fce8a3dd29a4ed2ec566fb53efbb04d8c44a0f05bc6f24a73046910fb9c3ce7afa35a0980500668fa3573345bd644644fa98338fa168235c80f4aa17aa17fbef
ENV CI=true

RUN addgroup -S -g 790 agent
RUN adduser -S -G agent -u 790 agent

RUN mkdir -p /workspace && chown agent:agent /workspace

USER agent

WORKDIR /workspace

RUN mkdir -p /workspace/packages/ai-lib /workspace/agents

COPY --chown=agent:agent ./package.json ./pnpm-lock.yaml ./pnpm-workspace.yaml /workspace/
COPY --chown=agent:agent ./packages/ai-lib/package.json /workspace/packages/ai-lib/
COPY --chown=agent:agent ./agents/package.json /workspace/agents/

RUN --mount=type=secret,id=npm_token,uid=790 \
  printf "//gdartifactory1.jfrog.io/artifactory/api/npm/node-virt/:_authToken=%s\n//gdartifactory1.jfrog.io/artifactory/api/npm/node-virt/:always-auth=true\nregistry=https://gdartifactory1.jfrog.io/artifactory/api/npm/node-virt/\n" "$(cat /run/secrets/npm_token)" > ~/.npmrc && \
  pnpm install --frozen-lockfile && \
  rm -f ~/.npmrc

COPY --chown=agent:agent ./packages/ai-lib /workspace/packages/ai-lib
RUN cd /workspace/packages/ai-lib && pnpm build

COPY --chown=agent:agent ./agents /workspace/agents

RUN cd /workspace/agents && pnpm build

RUN cp -r /workspace/agents/src/prompts /workspace/agents/dist/
RUN cp -r /workspace/agents/src/skills /workspace/agents/dist/
RUN cp -r /workspace/agents/src/utils/lucide-icons-map.js /workspace/agents/dist/utils/lucide-icons-map.js

USER root

RUN mkdir -p /management-scripts
COPY --chown=agent:agent ./agents/management-scripts/* /management-scripts/
RUN chmod +x /management-scripts/*.sh

RUN apk del python3 py3-setuptools make g++ && \
  npm cache clean --force

RUN mkdir -p /workspace/agents/data && chown agent:agent /workspace/agents/data

USER agent

WORKDIR /workspace/agents

ENV NODE_ENV=production

ENTRYPOINT ["/management-scripts/nomad_setup_and_serve.sh"]
CMD ["node", "/workspace/agents/dist/server/app.js"]

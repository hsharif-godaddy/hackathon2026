FROM 764525110978.dkr.ecr.us-west-2.amazonaws.com/node:22-alpine

USER root

RUN apk add --no-cache openssl
RUN npm install -g pnpm

# Use existing node user from base image (UID 1001)
RUN mkdir -p /workspace && chown node:node /workspace

USER node

WORKDIR /workspace

RUN mkdir -p /workspace/proxy

# Copy workspace config for proper pnpm install
COPY --chown=node:node ./package.json ./pnpm-lock.yaml ./pnpm-workspace.yaml /workspace/
COPY --chown=node:node ./proxy/package.json /workspace/proxy/

# Install workspace dependencies with Artifactory authentication
RUN --mount=type=secret,id=npm_token,uid=1001 \
  printf "//gdartifactory1.jfrog.io/artifactory/api/npm/node-virt/:_authToken=%s\n//gdartifactory1.jfrog.io/artifactory/api/npm/node-virt/:always-auth=true\nregistry=https://gdartifactory1.jfrog.io/artifactory/api/npm/node-virt/\n" "$(cat /run/secrets/npm_token)" > ~/.npmrc && \
  pnpm install --frozen-lockfile && \
  rm -f ~/.npmrc

# Copy proxy source
COPY --chown=node:node ./proxy /workspace/proxy

# Build TypeScript
RUN cd /workspace/proxy && pnpm run build

# Create SSL directory and generate self-signed certificate
RUN mkdir -p /workspace/proxy/ssl && \
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout /workspace/proxy/ssl/server.key \
    -out /workspace/proxy/ssl/server.crt \
    -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost"

# Make setup script executable
RUN chmod +x /workspace/proxy/setup-certs.sh

WORKDIR /workspace/proxy

EXPOSE 8888

CMD ["sh", "-c", "./setup-certs.sh && pnpm start"]
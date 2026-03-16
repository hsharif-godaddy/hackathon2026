FROM 764525110978.dkr.ecr.us-west-2.amazonaws.com/node:22-alpine

USER root

RUN apk add --no-cache openssl
RUN npm install -g pnpm

# Use existing node user from base image (UID 1001)
RUN mkdir -p /workspace && chown node:node /workspace

# Create SSL directory and generate self-signed certificate at /app/proxy/ssl
RUN mkdir -p /app/proxy/ssl && \
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout /app/proxy/ssl/server.key \
    -out /app/proxy/ssl/server.crt \
    -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost"

# Accept NPM auth token as build arg
ARG ARTIFACTORY_NPM_TOKEN

# Copy workspace files for pnpm
COPY --chown=node:node package.json pnpm-workspace.yaml pnpm-lock.yaml /app
COPY --chown=node:node proxy/package.json ./proxy/

# Create .npmrc with auth
RUN echo "registry=https://gdartifactory1.jfrog.io/artifactory/api/npm/node-virt/" > .npmrc && \
    echo "replace-registry-host=always" >> .npmrc && \
    echo "//gdartifactory1.jfrog.io/artifactory/api/npm/node-virt/:_authToken=${ARTIFACTORY_NPM_TOKEN}" >> .npmrc;

# Install dependencies from workspace root
WORKDIR /app
RUN pnpm install --filter airo-proxy --frozen-lockfile

# Switch to proxy directory
WORKDIR /app/proxy

# Copy source code and configuration
COPY --chown=node:node proxy/src/ ./src/
COPY --chown=node:node proxy/tsconfig.json ./
COPY --chown=node:node proxy/setup-certs.sh ./

# Build TypeScript
RUN pnpm --filter airo-proxy run build

# Make setup script executable
RUN chmod +x setup-certs.sh

# Change ownership of the app directory  
RUN chown -R node:node /app

# Expose port
EXPOSE 8888

# Switch to non-root user
USER node

WORKDIR /workspace

RUN mkdir -p /workspace/proxy

# Copy workspace config for proper pnpm install
COPY --chown=node:node ./package.json ./pnpm-lock.yaml ./pnpm-workspace.yaml /workspace/
COPY --chown=node:node ./proxy/package.json /workspace/proxy/

# Install workspace dependencies with Artifactory authentication
RUN --mount=type=secret,id=npm_token,uid=1001 \
  printf "//gdartifactory1.jfrog.io/artifactory/api/npm/node-virt/:_authToken=%s\n//gdartifactory1.jfrog.io/artifactory/api/npm/node-virt/:always-auth=true\nregistry=https://gdartifactory1.jfrog.io/artifactory/api/npm/node-virt/\n" "$(cat /run/secrets/npm_token)" > ~/.npmrc && \
  pnpm install --filter airo-proxy --frozen-lockfile && \
  rm -f ~/.npmrc

# Copy proxy source
COPY --chown=node:node ./proxy /workspace/proxy

# Build TypeScript
RUN cd /workspace/proxy && pnpm --filter airo-proxy run build

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
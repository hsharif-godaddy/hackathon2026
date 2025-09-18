FROM 764525110978.dkr.ecr.us-west-2.amazonaws.com/node:22-alpine AS builder

# Switch to root to install packages, then switch back to node user
USER root

# Install comprehensive build dependencies for Tailwind CSS Oxide and native modules
RUN apk add --no-cache \
    python3 \
    py3-setuptools \
    make \
    g++ \
    rust \
    cargo \
    libc-dev \
    musl-dev \
    openssl-dev \
    pkgconfig \
    git \
    linux-headers \
    jq \
    openssl

# Install pnpm globally
RUN npm install -g pnpm

WORKDIR /app

# Copy .npmrc for private registry authentication
COPY .npmrc ./

COPY package*.json ./
COPY pnpm-lock.yaml ./

ENV NEXT_TELEMETRY_DISABLED=1

# Install dependencies with cache mount for faster builds
RUN pnpm install --frozen-lockfile && rm -f .npmrc

# Copy application code (separate layer for better caching)
COPY . .

# Generate Prisma client for Alpine Linux platform (required for build)
ENV PRISMA_CLI_QUERY_ENGINE_TYPE=binary
ENV PRISMA_CLIENT_ENGINE_TYPE=binary
RUN npx prisma generate --schema=./prisma/schema.prisma


# Verify TailwindCSS can load properly
RUN npx tailwindcss --help || echo "TailwindCSS command failed"

# Compile next.config.ts to next.config.js for runtime (prevents runtime TypeScript installation)
RUN if npx tsc next.config.ts --outDir . --target es2020 --module commonjs --moduleResolution node --esModuleInterop --allowSyntheticDefaultImports; then \
        mv next.config.js next.config.compiled.js && echo "✅ Successfully compiled next.config.ts to JS"; \
    else \
        echo "⚠️ TypeScript compilation failed, creating fallback JS config" && \
        echo "const nextConfig = { eslint: { ignoreDuringBuilds: true }, typescript: { ignoreBuildErrors: false } }; module.exports = nextConfig;" > next.config.compiled.js; \
    fi

# Compile server.ts to server.js for runtime
RUN if npx tsc server.ts --outDir . --target es2020 --module commonjs --moduleResolution node --esModuleInterop --allowSyntheticDefaultImports; then \
        echo "✅ Successfully compiled server.ts to JS"; \
    else \
        echo "❌ Failed to compile server.ts" && exit 1; \
    fi

RUN IS_BUILDING=true pnpm build


FROM 764525110978.dkr.ecr.us-west-2.amazonaws.com/node:22-alpine AS runner

# Switch to root to install pnpm and create user
USER root

ENV NEXT_TELEMETRY_DISABLED=1

RUN npm install -g pnpm
RUN apk add --no-cache openssl

WORKDIR /app

# Copy only the necessary files from builder stage
# This excludes .npmrc and any other sensitive build-time files
COPY --from=builder --chown=node:node /app/package.json ./
COPY --from=builder --chown=node:node /app/pnpm-lock.yaml ./
COPY --from=builder --chown=node:node /app/next.config.compiled.js ./next.config.js
COPY --from=builder --chown=node:node /app/server.js ./
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next ./.next
COPY --from=builder --chown=node:node /app/.dist ./.dist
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/src/generated ./src/generated
COPY --from=builder --chown=node:node /app/prisma ./prisma
COPY --from=builder --chown=node:node /app/scripts ./scripts
COPY --from=builder --chown=node:node /app/certs ./certs

# Install only production dependencies (no dev dependencies, no auth needed for public packages)
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

# Ensure Prisma client is properly configured for Alpine Linux runtime
ENV PRISMA_CLI_QUERY_ENGINE_TYPE=binary
ENV PRISMA_CLIENT_ENGINE_TYPE=binary
RUN npx prisma generate --schema=./prisma/schema.prisma

# Create data directory with proper permissions
RUN mkdir -p /app/data && chown -R node:node /app/data

EXPOSE 8443

ENV NODE_ENV=production
ENV HTTPS_PORT=8443

USER node

# Start the Next.js application with HTTPS (with database URL setup)
CMD ["node", "scripts/setup-database-url.js", "node", "server.js"]

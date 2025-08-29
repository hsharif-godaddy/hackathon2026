# Use ECR Node.js Alpine image
ARG UPSTREAM_VERSION=22

# ========================================
# STAGE 1: Builder - Contains sensitive data
# ========================================
FROM 764525110978.dkr.ecr.us-west-2.amazonaws.com/node:${UPSTREAM_VERSION}-alpine AS builder

# Build argument for NPM authentication (optional)
ARG NPM_AUTH_TOKEN=""

# Switch to root to install packages, then switch back to node user
USER root

# Install comprehensive build dependencies for Tailwind CSS Oxide
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
    git

# Install pnpm globally
RUN npm install -g pnpm

# Switch to node user for application operations
USER node
WORKDIR /app

# Create npm configuration for private registry
# If NPM_AUTH_TOKEN is provided, use it; otherwise rely on org-level auth
RUN echo "registry=https://gdartifactory1.jfrog.io/artifactory/api/npm/node-virt/" > .npmrc && \
    if [ -n "$NPM_AUTH_TOKEN" ] && [ "$NPM_AUTH_TOKEN" != "dummy" ]; then \
        echo "//gdartifactory1.jfrog.io/artifactory/api/npm/node-virt/:_authToken=${NPM_AUTH_TOKEN}" >> .npmrc; \
    fi

COPY package*.json ./
COPY pnpm-lock.yaml ./

# Install dependencies with cache mount for faster builds
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    --mount=type=cache,target=/root/.npm \
    pnpm install

# Copy application code (separate layer for better caching)
COPY . .

# Pre-build Tailwind CSS to ensure native bindings are compiled before Next.js build
RUN npx tailwindcss --help || true

# Build the application
RUN pnpm build

# Clean up sensitive files in builder stage for added security
RUN rm -f .npmrc

# ========================================
# STAGE 2: Runner - Clean final image without secrets
# ========================================
FROM 764525110978.dkr.ecr.us-west-2.amazonaws.com/node:${UPSTREAM_VERSION}-alpine AS runner

# Switch to root to install pnpm and create user
USER root
RUN npm install -g pnpm

# Switch to node user
USER node
WORKDIR /app

# Copy only the necessary files from builder stage
# This excludes .npmrc and any other sensitive build-time files
COPY --from=builder --chown=node:node /app/package*.json ./
COPY --from=builder --chown=node:node /app/pnpm-lock.yaml ./
COPY --from=builder --chown=node:node /app/next.config.ts ./
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next ./.next
COPY --from=builder --chown=node:node /app/node_modules ./node_modules

# Install only production dependencies (no dev dependencies, no auth needed for public packages)
RUN pnpm install --prod --frozen-lockfile || true

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

# Start the Next.js application
CMD ["pnpm", "start"]

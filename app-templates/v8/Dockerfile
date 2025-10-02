ARG UPSTREAM_VERSION=22
ARG DEV_SUPERVISOR_IMAGE="dev-supervisor:latest"

FROM ${DEV_SUPERVISOR_IMAGE} AS dev-supervisor

FROM 764525110978.dkr.ecr.us-west-2.amazonaws.com/node:${UPSTREAM_VERSION}-alpine

USER root

# Install python and build tools
RUN apk add --no-cache python3 py3-setuptools make g++ curl git ca-certificates tzdata

# Install pnpm
RUN npm install -g pnpm

# create the group and user
# hardcoded the GID of the agent group to 790, UID of the agent user to 790 for now
RUN addgroup -S -g 790 agent
RUN adduser -S -G agent -u 790 agent

# Copy dev-supervisor binary from pre-built image
COPY --chown=agent:agent --from=dev-supervisor /usr/local/bin/dev-supervisor /usr/local/bin/dev-supervisor

# Copy package files first to check for pnpm-lock.yaml
COPY --chown=agent:agent package.json /app-template/
COPY --chown=agent:agent pnpm-lock.yaml* /app-template/

# Enable corepack and prepare pnpm as root if pnpm-lock.yaml exists
# Configure pnpm to use a shared store location accessible by both users
RUN if [ -f /app-template/pnpm-lock.yaml ]; then \
    corepack enable && corepack prepare pnpm@latest --activate && \
    mkdir -p /shared/pnpm-store && \
    chown -R agent:agent /shared/pnpm-store && \
    chmod -R 775 /shared/pnpm-store && \
    pnpm config set store-dir /shared/pnpm-store --global; \
    fi

# copy all except nomad_setup_and_serve.sh to /app-template
COPY --chown=agent:agent . /app-template

RUN rm -f /app-template/*.sh

# create the management-scripts directory and set ownership
RUN mkdir -p /management-scripts
RUN chown agent:agent /management-scripts

# copy nomad_setup_and_serve.sh to /management-scripts
COPY --chown=agent:agent nomad_setup_and_serve.sh /management-scripts/nomad_setup_and_serve.sh

RUN chmod +x /management-scripts/nomad_setup_and_serve.sh

WORKDIR /app-template

# Create logs directory and supervisor socket directory
RUN mkdir -p logs /tmp/supervisor

# Make sure the agent user owns the app directory
RUN chown -R agent:agent /app-template

# Switch to the agent user so we are not running as root
USER agent

# Configure pnpm store for agent user if pnpm-lock.yaml exists
RUN if [ -f pnpm-lock.yaml ]; then \
    pnpm config set store-dir /shared/pnpm-store; \
    fi

# Install dependencies as the agent user
# Note: v8 template maintains its own lockfile separate from workspace
# The lockfile should be kept up-to-date via CI automation
RUN pnpm install --frozen-lockfile --registry=https://registry.npmjs.org/

# Set development environment variables
ENV NODE_ENV=development
ENV VITE_HMR_HOST=0.0.0.0
ENV RUNNING_IN_DOCKER=true

# Use dev-supervisor as PID 1 to manage the development process
ENTRYPOINT ["/usr/local/bin/dev-supervisor"]
CMD ["/bin/sh", "/management-scripts/nomad_setup_and_serve.sh"]
